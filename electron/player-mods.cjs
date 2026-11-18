const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { inflateRawSync } = require('node:zlib');
const { locateRobloxPlayer, robloxVersionsPath } = require('./roblox-bootstrapper.cjs');

const PACK_SCHEMA = 'eclipse-player-pack/v1';
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 96 * 1024;
const MAX_ASSETS = 48;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 28 * 1024 * 1024;
const MAX_BACKUP_BYTES = 96 * 1024 * 1024;
const MAX_PACKS = 40;
const MAX_BACKUP_FILES = MAX_PACKS * MAX_ASSETS;
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const PACK_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const ASSET_KINDS = Object.freeze(['texture', 'sound']);

class PlayerModsError extends Error {
  constructor(message, code = 'PLAYER_MODS_ERROR') {
    super(message);
    this.name = 'PlayerModsError';
    this.code = code;
  }
}

function safeRelativePath(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim().replace(/\\/g, '/');
  if (!text || text.length > 220 || text.includes('\0') || text.includes(':') || text.startsWith('/') || /^[A-Za-z]:/.test(text)) return '';
  const normalized = path.posix.normalize(text);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized.startsWith('/')) return '';
  return normalized;
}

function normalizeTarget(value) {
  const target = safeRelativePath(value);
  const lower = target.toLowerCase();
  if (lower.startsWith('content/textures/')) return { target, kind: 'texture' };
  if (lower.startsWith('content/sounds/')) return { target, kind: 'sound' };
  return null;
}

function normalizePackId(value) {
  const id = String(value || '').trim().toLowerCase();
  return PACK_ID_PATTERN.test(id) ? id : '';
}

function trimText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeManifest(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    throw new PlayerModsError('The pack manifest must be a JSON object.', 'INVALID_MANIFEST');
  }
  if (input.schema !== PACK_SCHEMA) {
    throw new PlayerModsError('This package is not an Eclipse Player pack.', 'INVALID_MANIFEST');
  }
  const id = normalizePackId(input.id);
  const name = trimText(input.name, 60);
  const version = trimText(input.version, 32);
  const description = trimText(input.description, 320);
  if (!id || !name || !PACK_VERSION_PATTERN.test(version)) {
    throw new PlayerModsError('Pack manifests need a lowercase ID, name, and compact version.', 'INVALID_MANIFEST');
  }
  if (!Array.isArray(input.assets) || !input.assets.length || input.assets.length > MAX_ASSETS) {
    throw new PlayerModsError(`A pack must declare between 1 and ${MAX_ASSETS} assets.`, 'INVALID_MANIFEST');
  }

  const sources = new Set();
  const targets = new Set();
  const assets = input.assets.map((asset) => {
    const source = safeRelativePath(asset?.source);
    const targetInfo = normalizeTarget(asset?.target);
    const kind = String(asset?.kind || '').trim().toLowerCase();
    if (!source || !targetInfo || !ASSET_KINDS.includes(kind) || targetInfo.kind !== kind || sources.has(source.toLowerCase()) || targets.has(targetInfo.target.toLowerCase())) {
      throw new PlayerModsError('Every asset needs a unique declared source and an allowlisted texture or sound target.', 'INVALID_MANIFEST');
    }
    sources.add(source.toLowerCase());
    targets.add(targetInfo.target.toLowerCase());
    return { source, target: targetInfo.target, kind };
  });

  return { schema: PACK_SCHEMA, id, name, version, description, assets };
}

function detectAsset(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'texture', mime: 'image/png', extensions: new Set(['.png']) };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { kind: 'texture', mime: 'image/jpeg', extensions: new Set(['.jpg', '.jpeg']) };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { kind: 'texture', mime: 'image/webp', extensions: new Set(['.webp']) };
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return { kind: 'sound', mime: 'audio/ogg', extensions: new Set(['.ogg']) };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return { kind: 'sound', mime: 'audio/wav', extensions: new Set(['.wav']) };
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && [0xfb, 0xf3, 0xf2].includes(buffer[1]))) return { kind: 'sound', mime: 'audio/mpeg', extensions: new Set(['.mp3']) };
  return null;
}

function validateAssetBuffer(asset, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ASSET_BYTES) {
    throw new PlayerModsError(`Asset ${asset.source} exceeds Eclipse's size limit.`, 'INVALID_ASSET');
  }
  const detected = detectAsset(buffer);
  const targetExtension = path.posix.extname(asset.target).toLowerCase();
  if (!detected || detected.kind !== asset.kind || !detected.extensions.has(targetExtension)) {
    throw new PlayerModsError(`Asset ${asset.source} does not match the declared ${asset.kind} target.`, 'INVALID_ASSET');
  }
  return { ...asset, mime: detected.mime, size: buffer.length };
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > MAX_PACKAGE_BYTES) {
    throw new PlayerModsError('The .eclipsepack archive is missing or too large.', 'INVALID_PACKAGE');
  }
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) throw new PlayerModsError('The .eclipsepack archive has no ZIP directory.', 'INVALID_PACKAGE');
  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const directoryDisk = buffer.readUInt16LE(endOffset + 6);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const centralEnd = centralOffset + centralSize;
  if (diskNumber || directoryDisk || entryCount > MAX_ASSETS + 1 || centralEnd !== endOffset) {
    throw new PlayerModsError('ZIP64, multi-disk, or malformed .eclipsepack archives are not supported.', 'INVALID_PACKAGE');
  }

  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new PlayerModsError('The .eclipsepack central directory is invalid.', 'INVALID_PACKAGE');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameEnd = offset + 46 + nameLength;
    if ((flags & ~0x0808) || ![0, 8].includes(compression) || nameEnd > centralEnd || uncompressedSize > MAX_ASSET_BYTES || compressedSize > MAX_PACKAGE_BYTES) {
      throw new PlayerModsError('The .eclipsepack contains encrypted, unsupported, or oversized files.', 'INVALID_PACKAGE');
    }
    const name = safeRelativePath(buffer.subarray(offset + 46, nameEnd).toString('utf8'));
    const entryLength = 46 + nameLength + extraLength + commentLength;
    if (!name || offset + entryLength > centralEnd || entries.has(name) || name.endsWith('/')) {
      throw new PlayerModsError('The .eclipsepack contains unsafe or duplicate paths.', 'INVALID_PACKAGE');
    }
    entries.set(name, { name, flags, compression, compressedSize, uncompressedSize, localOffset });
    offset += entryLength;
  }
  return entries;
}

function readZipEntry(buffer, entry) {
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new PlayerModsError('The .eclipsepack contains an invalid local file entry.', 'INVALID_PACKAGE');
  }
  const flags = buffer.readUInt16LE(offset + 6);
  const compression = buffer.readUInt16LE(offset + 8);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const localNameEnd = offset + 30 + nameLength;
  if (flags !== entry.flags || (flags & ~0x0808) || compression !== entry.compression || localNameEnd > buffer.length || buffer.subarray(offset + 30, localNameEnd).toString('utf8') !== entry.name) {
    throw new PlayerModsError('The .eclipsepack contains mismatched local file data.', 'INVALID_PACKAGE');
  }
  const contentStart = offset + 30 + nameLength + extraLength;
  const contentEnd = contentStart + entry.compressedSize;
  if (contentEnd > buffer.length) throw new PlayerModsError('The .eclipsepack file data is incomplete.', 'INVALID_PACKAGE');
  const compressed = buffer.subarray(contentStart, contentEnd);
  let content;
  try {
    content = entry.compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
  } catch {
    throw new PlayerModsError('The .eclipsepack contains invalid compressed data.', 'INVALID_PACKAGE');
  }
  if (content.length !== entry.uncompressedSize || content.length > MAX_ASSET_BYTES) {
    throw new PlayerModsError('The .eclipsepack contains an invalid file size.', 'INVALID_PACKAGE');
  }
  return content;
}

function parseManifestBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_MANIFEST_BYTES) {
    throw new PlayerModsError('The pack manifest is too large.', 'INVALID_MANIFEST');
  }
  try {
    return normalizeManifest(JSON.parse(buffer.toString('utf8')));
  } catch (error) {
    if (error instanceof PlayerModsError) throw error;
    throw new PlayerModsError('The pack manifest is not valid JSON.', 'INVALID_MANIFEST');
  }
}

async function readBoundedFile(filePath, maxBytes, message, code = 'INVALID_PACKAGE') {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size < 0 || info.size > maxBytes) throw new PlayerModsError(message, code);
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw new PlayerModsError(message, code);
      offset += bytesRead;
    }
    return buffer;
  } catch (error) {
    if (error instanceof PlayerModsError) throw error;
    throw new PlayerModsError(message, code);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function atomicWrite(destination, content) {
  const directory = path.dirname(destination);
  const temporaryPath = path.join(directory, `.eclipse-${randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, content);
    await fs.rename(temporaryPath, destination);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicCopy(source, destination) {
  const directory = path.dirname(destination);
  const temporaryPath = path.join(directory, `.eclipse-${randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.copyFile(source, temporaryPath);
    await fs.rename(temporaryPath, destination);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function isRobloxPlayerRunning({ platform = process.platform, execFileImpl = execFile } = {}) {
  if (platform !== 'win32') return false;
  return new Promise((resolve, reject) => {
    execFileImpl('tasklist.exe', ['/FI', 'IMAGENAME eq RobloxPlayerBeta.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 128 * 1024 }, (error, stdout = '') => {
      if (error) {
        reject(new PlayerModsError('Eclipse could not confirm whether Roblox Player is closed.', 'PLAYER_PROCESS_CHECK_FAILED'));
        return;
      }
      resolve(/"RobloxPlayerBeta\.exe"/i.test(String(stdout)));
    });
  });
}

function isPathInside(rootDirectory, candidate) {
  const relative = path.relative(rootDirectory, candidate);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolvePlayerTarget(playerDirectory, target) {
  const safeTarget = safeRelativePath(target);
  if (!safeTarget) throw new PlayerModsError('A pack target is unsafe.', 'INVALID_TARGET');
  const root = path.resolve(playerDirectory);
  const destination = path.resolve(root, ...safeTarget.split('/'));
  if (!isPathInside(root, destination)) throw new PlayerModsError('A pack target escaped the Player folder.', 'INVALID_TARGET');
  return destination;
}

function normalizeStoredPack(value) {
  const manifest = normalizeManifest(value);
  const enabled = value?.enabled === true;
  const needsReview = value?.needsReview === true;
  const metadata = value?.assetMetadata && typeof value.assetMetadata === 'object'
    ? value.assetMetadata
    : Object.fromEntries((Array.isArray(value?.assets) ? value.assets : []).map((asset) => [asset?.source, { mime: asset?.mime, size: asset?.size }]));
  const assets = manifest.assets.map((asset) => ({
    ...asset,
    mime: typeof metadata?.[asset.source]?.mime === 'string' ? metadata[asset.source].mime : '',
    size: Number.isSafeInteger(metadata?.[asset.source]?.size) ? metadata[asset.source].size : 0
  }));
  if (assets.some((asset) => !asset.mime || asset.size <= 0 || asset.size > MAX_ASSET_BYTES)) throw new PlayerModsError('Stored pack metadata is invalid.', 'INVALID_STORED_PACK');
  return {
    ...manifest,
    assets,
    enabled,
    needsReview,
    importedAt: typeof value.importedAt === 'string' ? value.importedAt : new Date().toISOString(),
    lastAppliedVersion: typeof value.lastAppliedVersion === 'string' ? value.lastAppliedVersion.slice(0, 140) : '',
    lastError: typeof value.lastError === 'string' ? value.lastError.slice(0, 240) : ''
  };
}

function emptyState() {
  return { schema: 'eclipse-player-mods/v1', packs: [] };
}

function normalizeState(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || value.schema !== 'eclipse-player-mods/v1' || !Array.isArray(value.packs) || value.packs.length > MAX_PACKS) {
    throw new PlayerModsError('The local Player pack library is invalid. Eclipse will not modify Player files until it is repaired.', 'INVALID_STATE');
  }
  const packs = value.packs.map(normalizeStoredPack);
  const ids = new Set();
  for (const pack of packs) {
    if (ids.has(pack.id)) throw new PlayerModsError('The local Player pack library has duplicate IDs.', 'INVALID_STATE');
    ids.add(pack.id);
  }
  return { schema: 'eclipse-player-mods/v1', packs };
}

function normalizeBackupFiles(value) {
  if (!Array.isArray(value) || value.length > MAX_BACKUP_FILES) {
    throw new PlayerModsError('The local Player backup index is invalid.', 'BACKUP_READ_FAILED');
  }
  const targets = new Set();
  let totalBytes = 0;
  const files = value.map((item) => {
    const target = normalizeTarget(item?.target)?.target || '';
    const size = Number(item?.size);
    if (!target || !Number.isSafeInteger(size) || size <= 0 || size > MAX_BACKUP_BYTES || targets.has(target.toLowerCase())) {
      throw new PlayerModsError('The local Player backup index is invalid.', 'BACKUP_READ_FAILED');
    }
    targets.add(target.toLowerCase());
    totalBytes += size;
    if (totalBytes > MAX_BACKUP_BYTES) throw new PlayerModsError('The local Player backup index exceeds Eclipse’s safety limit.', 'BACKUP_READ_FAILED');
    return { target, size };
  });
  return files;
}

class PlayerMods {
  constructor({ platform = process.platform, storageRoot, locatePlayer = null, isPlayerRunning = null } = {}) {
    this.platform = platform;
    this.storageRoot = storageRoot || path.join(process.cwd(), '.eclipse-player-mods');
    this.locatePlayer = locatePlayer || (() => locateRobloxPlayer(robloxVersionsPath()));
    this.isPlayerRunning = isPlayerRunning || (() => isRobloxPlayerRunning({ platform }));
  }

  supported() {
    return this.platform === 'win32';
  }

  paths() {
    return {
      state: path.join(this.storageRoot, 'state.json'),
      packs: path.join(this.storageRoot, 'packs'),
      backups: path.join(this.storageRoot, 'backups')
    };
  }

  packDirectory(id) {
    const safeId = normalizePackId(id);
    if (!safeId) throw new PlayerModsError('The pack ID is invalid.', 'INVALID_PACK_ID');
    return path.join(this.paths().packs, safeId);
  }

  backupDirectory(versionGuid) {
    if (!/^version-[A-Za-z0-9-]{8,128}$/.test(String(versionGuid || ''))) {
      throw new PlayerModsError('The Roblox Player version is invalid.', 'INVALID_PLAYER_VERSION');
    }
    return path.join(this.paths().backups, versionGuid);
  }

  async readState() {
    try {
      return normalizeState(JSON.parse(await fs.readFile(this.paths().state, 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyState();
      if (error instanceof PlayerModsError) throw error;
      if (error instanceof SyntaxError) throw new PlayerModsError('The local Player pack library is invalid. Eclipse will not modify Player files until it is repaired.', 'INVALID_STATE');
      throw new PlayerModsError(`Eclipse could not read the local mod library. ${error.message}`, 'STATE_READ_FAILED');
    }
  }

  async writeState(state) {
    const normalized = normalizeState(state);
    await atomicWrite(this.paths().state, `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  }

  async playerStatus() {
    if (!this.supported()) return { supported: false, installed: false, playerRunning: false, reason: 'Player packs are available in the Windows Eclipse desktop app only.' };
    let player;
    try {
      player = await this.locatePlayer();
    } catch (error) {
      return { supported: true, installed: false, playerRunning: false, reason: `Eclipse could not inspect Roblox Player. ${error.message}` };
    }
    if (!player) return { supported: true, installed: false, playerRunning: false, reason: 'Roblox Player was not found. Install it through Player Health first.' };
    try {
      const playerRunning = await this.isPlayerRunning();
      return { supported: true, installed: true, playerRunning, versionGuid: player.versionGuid, reason: playerRunning ? 'Close Roblox Player before Eclipse applies or restores a local pack.' : '' };
    } catch (error) {
      return { supported: true, installed: true, playerRunning: true, versionGuid: player.versionGuid, reason: error instanceof Error ? error.message : 'Eclipse could not confirm whether Roblox Player is closed.' };
    }
  }

  async status() {
    const [state, player] = await Promise.all([this.readState(), this.playerStatus()]);
    return {
      ...player,
      packs: state.packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        description: pack.description,
        enabled: pack.enabled,
        needsReview: pack.needsReview,
        importedAt: pack.importedAt,
        lastAppliedVersion: pack.lastAppliedVersion,
        lastError: pack.lastError,
        assets: pack.assets.map(({ source, target, kind, mime, size }) => ({ source, target, kind, mime, size }))
      }))
    };
  }

  async importPackage(filePath) {
    if (!this.supported()) throw new PlayerModsError('Player packs are available in the Windows Eclipse desktop app only.', 'UNSUPPORTED_PLATFORM');
    if (path.extname(String(filePath || '')).toLowerCase() !== '.eclipsepack') {
      throw new PlayerModsError('Choose a .eclipsepack archive.', 'INVALID_PACKAGE');
    }
    const archive = await readBoundedFile(filePath, MAX_PACKAGE_BYTES, 'Choose a .eclipsepack archive smaller than 32 MB.');
    const entries = readZipEntries(archive);
    const manifestEntry = entries.get('manifest.json');
    if (!manifestEntry) throw new PlayerModsError('The .eclipsepack archive needs a manifest.json file.', 'INVALID_PACKAGE');
    const manifest = parseManifestBuffer(readZipEntry(archive, manifestEntry));
    const content = new Map();
    let declaredBytes = 0;
    for (const asset of manifest.assets) {
      const entry = entries.get(asset.source);
      if (!entry) throw new PlayerModsError(`The .eclipsepack is missing ${asset.source}.`, 'INVALID_PACKAGE');
      declaredBytes += entry.uncompressedSize;
      if (declaredBytes > MAX_TOTAL_ASSET_BYTES) {
        throw new PlayerModsError('This .eclipsepack exceeds Eclipse’s 28 MB asset limit.', 'INVALID_PACKAGE');
      }
      content.set(asset.source, readZipEntry(archive, entry));
    }
    if ([...entries.keys()].some((name) => name !== 'manifest.json' && !content.has(name))) {
      throw new PlayerModsError('The .eclipsepack contains files that are not declared in its manifest.', 'INVALID_PACKAGE');
    }
    return this.storePack(manifest, content);
  }

  async importFolder(folderPath) {
    if (!this.supported()) throw new PlayerModsError('Player packs are available in the Windows Eclipse desktop app only.', 'UNSUPPORTED_PLATFORM');
    const rootInfo = await fs.stat(folderPath);
    if (!rootInfo.isDirectory()) throw new PlayerModsError('Choose a folder containing manifest.json.', 'INVALID_PACKAGE');
    const realRoot = await fs.realpath(folderPath);
    const manifestPath = path.join(realRoot, 'manifest.json');
    let manifestInfo;
    try {
      manifestInfo = await fs.lstat(manifestPath);
    } catch {
      throw new PlayerModsError('Choose a folder containing manifest.json.', 'INVALID_PACKAGE');
    }
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) {
      throw new PlayerModsError('The folder pack manifest must be a regular manifest.json file.', 'INVALID_PACKAGE');
    }
    const realManifest = await fs.realpath(manifestPath);
    if (!isPathInside(realRoot, realManifest)) throw new PlayerModsError('The folder pack manifest escaped its package directory.', 'INVALID_PACKAGE');
    const manifest = parseManifestBuffer(await readBoundedFile(realManifest, MAX_MANIFEST_BYTES, 'The pack manifest is too large.', 'INVALID_MANIFEST'));
    const assetPaths = [];
    let declaredBytes = 0;
    for (const asset of manifest.assets) {
      const candidate = path.resolve(realRoot, ...asset.source.split('/'));
      if (!isPathInside(realRoot, candidate)) throw new PlayerModsError('A folder pack asset escaped its package directory.', 'INVALID_PACKAGE');
      const realCandidate = await fs.realpath(candidate);
      if (!isPathInside(realRoot, realCandidate)) throw new PlayerModsError('Folder pack symlinks must stay inside the package directory.', 'INVALID_PACKAGE');
      const info = await fs.stat(realCandidate);
      if (!info.isFile() || info.size > MAX_ASSET_BYTES) throw new PlayerModsError(`Asset ${asset.source} is missing or too large.`, 'INVALID_ASSET');
      declaredBytes += info.size;
      if (declaredBytes > MAX_TOTAL_ASSET_BYTES) throw new PlayerModsError('This folder pack exceeds Eclipse’s 28 MB asset limit.', 'INVALID_PACKAGE');
      assetPaths.push({ source: asset.source, path: realCandidate });
    }
    const content = new Map();
    let loadedBytes = 0;
    for (const asset of assetPaths) {
      const buffer = await readBoundedFile(asset.path, MAX_ASSET_BYTES, `Asset ${asset.source} is missing or too large.`, 'INVALID_ASSET');
      loadedBytes += buffer.length;
      if (buffer.length > MAX_ASSET_BYTES || loadedBytes > MAX_TOTAL_ASSET_BYTES) {
        throw new PlayerModsError('This folder pack exceeds Eclipse’s 28 MB asset limit.', 'INVALID_PACKAGE');
      }
      content.set(asset.source, buffer);
    }
    return this.storePack(manifest, content);
  }

  async storePack(manifest, content) {
    const state = await this.readState();
    if (state.packs.some((pack) => pack.id === manifest.id)) {
      throw new PlayerModsError(`A local pack named ${manifest.id} already exists. Remove it before importing a replacement.`, 'DUPLICATE_PACK');
    }
    if (state.packs.length >= MAX_PACKS) throw new PlayerModsError(`Eclipse supports up to ${MAX_PACKS} local Player packs.`, 'PACK_LIMIT');
    let totalBytes = 0;
    const assets = [];
    for (const asset of manifest.assets) {
      const buffer = content.get(asset.source);
      const metadata = validateAssetBuffer(asset, buffer);
      totalBytes += metadata.size;
      if (totalBytes > MAX_TOTAL_ASSET_BYTES) throw new PlayerModsError('This pack exceeds Eclipse’s 28 MB asset limit.', 'INVALID_PACKAGE');
      assets.push({ ...metadata, buffer });
    }

    const packDirectory = this.packDirectory(manifest.id);
    await fs.rm(packDirectory, { recursive: true, force: true });
    try {
      const assetMetadata = {};
      for (const asset of assets) {
        assetMetadata[asset.source] = { mime: asset.mime, size: asset.size };
        await atomicWrite(path.join(packDirectory, 'files', ...asset.source.split('/')), asset.buffer);
      }
      const storedPack = {
        ...manifest,
        assetMetadata,
        enabled: false,
        needsReview: false,
        importedAt: new Date().toISOString(),
        lastAppliedVersion: '',
        lastError: ''
      };
      await atomicWrite(path.join(packDirectory, 'manifest.json'), `${JSON.stringify(storedPack, null, 2)}\n`);
      state.packs.push(normalizeStoredPack(storedPack));
      await this.writeState(state);
      return this.status();
    } catch (error) {
      await fs.rm(packDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async assertPlayerClosed(player) {
    if (await this.isPlayerRunning()) {
      throw new PlayerModsError('Close Roblox Player before Eclipse applies, restores, or removes a local pack.', 'PLAYER_RUNNING');
    }
    return player;
  }

  async readBackupIndex(versionGuid) {
    const directory = this.backupDirectory(versionGuid);
    const indexPath = path.join(directory, 'index.json');
    try {
      const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8'));
      if (!parsed || Array.isArray(parsed) || parsed.schema !== 'eclipse-player-mod-backup/v1') {
        throw new PlayerModsError('The local Player backup index is invalid.', 'BACKUP_READ_FAILED');
      }
      return { directory, indexPath, files: normalizeBackupFiles(parsed.files) };
    } catch (error) {
      if (error?.code === 'ENOENT') return { directory, indexPath, files: [] };
      if (error instanceof PlayerModsError) throw error;
      throw new PlayerModsError('Eclipse could not read the local mod backup index.', 'BACKUP_READ_FAILED');
    }
  }

  async writeBackupIndex(index) {
    index.files = normalizeBackupFiles(index.files);
    await atomicWrite(index.indexPath, `${JSON.stringify({ schema: 'eclipse-player-mod-backup/v1', files: index.files }, null, 2)}\n`);
  }

  async assertDestinationFile(destination, description, rootDirectory = '') {
    let info;
    try {
      info = await fs.lstat(destination);
    } catch {
      throw new PlayerModsError(`${description} does not exist in this Roblox Player version.`, 'INCOMPATIBLE_PLAYER_VERSION');
    }
    if (!info.isFile() || info.isSymbolicLink()) throw new PlayerModsError(`${description} is not a regular Player asset file.`, 'INVALID_TARGET');
    if (rootDirectory) {
      try {
        const [realRoot, realDestination] = await Promise.all([fs.realpath(rootDirectory), fs.realpath(destination)]);
        if (!isPathInside(realRoot, realDestination)) {
          throw new PlayerModsError(`${description} escaped its Eclipse-managed directory.`, 'INVALID_TARGET');
        }
      } catch (error) {
        if (error instanceof PlayerModsError) throw error;
        throw new PlayerModsError(`${description} could not be resolved safely.`, 'INVALID_TARGET');
      }
    }
    return info;
  }

  async backupOriginal(index, playerDirectory, target) {
    if (index.files.some((item) => item.target.toLowerCase() === target.toLowerCase())) return;
    const destination = resolvePlayerTarget(playerDirectory, target);
    const info = await this.assertDestinationFile(destination, target, playerDirectory);
    const existingBytes = index.files.reduce((sum, item) => sum + item.size, 0);
    if (existingBytes + info.size > MAX_BACKUP_BYTES) throw new PlayerModsError('The versioned backup would exceed Eclipse’s 96 MB safety limit.', 'BACKUP_TOO_LARGE');
    const backupPath = path.join(index.directory, 'files', ...target.split('/'));
    try {
      await fs.lstat(backupPath);
      throw new PlayerModsError(`A backup for ${target} is incomplete. Eclipse will not overwrite it.`, 'BACKUP_INCONSISTENT');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await atomicCopy(destination, backupPath);
    index.files.push({ target, size: info.size });
    await this.writeBackupIndex(index);
  }

  async restoreVersion(versionGuid, playerDirectory) {
    const index = await this.readBackupIndex(versionGuid);
    for (const item of index.files) {
      const backupPath = path.join(index.directory, 'files', ...item.target.split('/'));
      const backupInfo = await this.assertDestinationFile(backupPath, `Backup for ${item.target}`, path.join(index.directory, 'files'));
      if (backupInfo.size !== item.size) {
        throw new PlayerModsError(`Backup for ${item.target} does not match its local index.`, 'BACKUP_INCONSISTENT');
      }
      const destination = resolvePlayerTarget(playerDirectory, item.target);
      await this.assertDestinationFile(destination, item.target, playerDirectory);
      await atomicCopy(backupPath, destination);
    }
    return index.files.length;
  }

  async assetPath(pack, asset) {
    const source = safeRelativePath(asset.source);
    if (!source) throw new PlayerModsError('A stored pack asset is invalid.', 'INVALID_STORED_PACK');
    const packFilesDirectory = path.join(this.packDirectory(pack.id), 'files');
    const sourcePath = path.join(packFilesDirectory, ...source.split('/'));
    await this.assertDestinationFile(sourcePath, `Stored asset ${source}`, packFilesDirectory);
    const buffer = await readBoundedFile(sourcePath, MAX_ASSET_BYTES, `Stored asset ${source} is missing or too large.`, 'INVALID_STORED_PACK');
    validateAssetBuffer(asset, buffer);
    return sourcePath;
  }

  assertNoTargetConflicts(packs) {
    const claimedTargets = new Set();
    for (const pack of packs) {
      for (const asset of pack.assets) {
        const key = asset.target.toLowerCase();
        if (claimedTargets.has(key)) throw new PlayerModsError(`Enabled packs both target ${asset.target}. Disable one before applying.`, 'TARGET_CONFLICT');
        claimedTargets.add(key);
      }
    }
  }

  async applyEnabledPacks(state, player) {
    const enabled = state.packs.filter((pack) => pack.enabled).sort((left, right) => left.importedAt.localeCompare(right.importedAt));
    this.assertNoTargetConflicts(enabled);
    await this.restoreVersion(player.versionGuid, player.directory);
    const index = await this.readBackupIndex(player.versionGuid);
    try {
      for (const pack of enabled) {
        for (const asset of pack.assets) {
          const sourcePath = await this.assetPath(pack, asset);
          const destination = resolvePlayerTarget(player.directory, asset.target);
          await this.backupOriginal(index, player.directory, asset.target);
          await this.assertDestinationFile(destination, asset.target, player.directory);
          await atomicCopy(sourcePath, destination);
        }
        pack.lastAppliedVersion = player.versionGuid;
        pack.lastError = '';
      }
    } catch (error) {
      await this.restoreVersion(player.versionGuid, player.directory).catch(() => {});
      throw error;
    }
  }

  async setEnabled(id, enabled) {
    if (!this.supported()) throw new PlayerModsError('Player packs are available in the Windows Eclipse desktop app only.', 'UNSUPPORTED_PLATFORM');
    const state = await this.readState();
    const pack = state.packs.find((item) => item.id === normalizePackId(id));
    if (!pack) throw new PlayerModsError('That local Player pack was not found.', 'PACK_NOT_FOUND');
    const player = await this.locatePlayer();
    if (!player) throw new PlayerModsError('Install Roblox Player through Player Health before applying a local pack.', 'PLAYER_NOT_INSTALLED');
    await this.assertPlayerClosed(player);
    const previousEnabled = pack.enabled;
    const previousReview = pack.needsReview;
    pack.enabled = enabled === true;
    if (pack.enabled) pack.needsReview = false;
    try {
      this.assertNoTargetConflicts(state.packs.filter((item) => item.enabled));
      await this.applyEnabledPacks(state, player);
      if (!pack.enabled) pack.lastAppliedVersion = '';
      await this.writeState(state);
      return this.status();
    } catch (error) {
      if (error?.code === 'TARGET_CONFLICT') {
        pack.enabled = previousEnabled;
        pack.needsReview = previousReview;
      } else {
        for (const item of state.packs) item.enabled = false;
      }
      pack.lastError = error instanceof Error ? error.message.slice(0, 240) : 'Eclipse could not apply the local pack.';
      await this.writeState(state);
      throw error;
    }
  }

  async restoreActive() {
    if (!this.supported()) throw new PlayerModsError('Player packs are available in the Windows Eclipse desktop app only.', 'UNSUPPORTED_PLATFORM');
    const state = await this.readState();
    const player = await this.locatePlayer();
    if (!player) throw new PlayerModsError('Roblox Player was not found.', 'PLAYER_NOT_INSTALLED');
    await this.assertPlayerClosed(player);
    const restored = await this.restoreVersion(player.versionGuid, player.directory);
    for (const pack of state.packs) {
      pack.enabled = false;
      pack.lastAppliedVersion = '';
    }
    await this.writeState(state);
    return { ...(await this.status()), restored };
  }

  async removePack(id) {
    if (!this.supported()) throw new PlayerModsError('Player packs are available in the Windows Eclipse desktop app only.', 'UNSUPPORTED_PLATFORM');
    const state = await this.readState();
    const index = state.packs.findIndex((pack) => pack.id === normalizePackId(id));
    if (index < 0) throw new PlayerModsError('That local Player pack was not found.', 'PACK_NOT_FOUND');
    if (state.packs[index].enabled) await this.setEnabled(id, false);
    const latest = await this.readState();
    latest.packs = latest.packs.filter((pack) => pack.id !== normalizePackId(id));
    await this.writeState(latest);
    await fs.rm(this.packDirectory(id), { recursive: true, force: true });
    return this.status();
  }

  async prepareForPlayerUpdate({ current = null } = {}) {
    const state = await this.readState();
    if (!state.packs.some((pack) => pack.enabled)) return { changed: false };
    const player = current || await this.locatePlayer();
    if (!player) return { changed: false };
    await this.assertPlayerClosed(player);
    await this.restoreVersion(player.versionGuid, player.directory);
    for (const pack of state.packs) {
      pack.enabled = false;
      pack.needsReview = true;
      pack.lastAppliedVersion = '';
      pack.lastError = 'Disabled for review after the official Roblox Player changed.';
    }
    await this.writeState(state);
    return { changed: true };
  }
}

function createPlayerMods(options = {}) {
  return new PlayerMods(options);
}

module.exports = {
  ASSET_KINDS,
  MAX_ASSET_BYTES,
  MAX_PACKAGE_BYTES,
  PACK_SCHEMA,
  PlayerMods,
  PlayerModsError,
  createPlayerMods,
  detectAsset,
  isRobloxPlayerRunning,
  normalizeManifest,
  normalizeTarget,
  readZipEntries,
  safeRelativePath
};
