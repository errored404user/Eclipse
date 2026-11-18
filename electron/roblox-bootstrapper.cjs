const { EventEmitter } = require('node:events');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { migrateManagedFlags } = require('./fast-flags.cjs');

const PLAYER_EXECUTABLE = 'RobloxPlayerBeta.exe';
const DEPLOYMENT_ENDPOINTS = Object.freeze([
  'https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer',
  'https://clientsettings.roblox.com/v2/client-version/WindowsPlayer'
]);
const OFFICIAL_INSTALLER_URL = 'https://www.roblox.com/download/client?os=win';
const FALLBACK_INSTALLER_URL = 'https://setup.rbxcdn.com/RobloxPlayerLauncher.exe';
const OFFICIAL_INSTALLER_HOSTS = new Set(['www.roblox.com', 'setup.rbxcdn.com', 'setup-aws.rbxcdn.com', 'setup-ak.rbxcdn.com']);
const ROBLOX_INSTALLER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 EclipseBootstrapper/0.1';
const MAX_INSTALLER_BYTES = 256 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

class RobloxBootstrapperError extends Error {
  constructor(message, code = 'BOOTSTRAPPER_ERROR') {
    super(message);
    this.name = 'RobloxBootstrapperError';
    this.code = code;
  }
}

function isSafeVersionGuid(value) {
  return /^version-[A-Za-z0-9-]{8,128}$/.test(String(value || ''));
}

function normalizeClientVersion(payload) {
  const versionGuid = String(payload?.clientVersionUpload || '').trim();
  if (!isSafeVersionGuid(versionGuid)) {
    throw new RobloxBootstrapperError('Roblox returned an invalid Windows Player version identifier.', 'INVALID_VERSION');
  }
  return {
    versionGuid,
    version: String(payload?.version || '').trim().slice(0, 128),
    bootstrapperVersion: String(payload?.bootstrapperVersion || '').trim().slice(0, 128)
  };
}

function localAppDataPath(env = process.env) {
  if (env.LOCALAPPDATA) return env.LOCALAPPDATA;
  if (env.USERPROFILE) return path.join(env.USERPROFILE, 'AppData', 'Local');
  return path.join(os.homedir(), 'AppData', 'Local');
}

function robloxVersionsPath(env = process.env) {
  return path.join(localAppDataPath(env), 'Roblox', 'Versions');
}

function installerUrlFor(versionGuid) {
  if (!isSafeVersionGuid(versionGuid)) throw new RobloxBootstrapperError('Roblox version identifier is invalid.', 'INVALID_VERSION');
  return OFFICIAL_INSTALLER_URL;
}

function installerFallbackUrlFor(versionGuid) {
  if (!isSafeVersionGuid(versionGuid)) throw new RobloxBootstrapperError('Roblox version identifier is invalid.', 'INVALID_VERSION');
  return FALLBACK_INSTALLER_URL;
}

function isOfficialRobloxDownload(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && OFFICIAL_INSTALLER_HOSTS.has(host);
  } catch {
    return false;
  }
}

function escapePowerShellLiteral(value) {
  return String(value).replace(/'/g, "''");
}

async function locateRobloxPlayer(versionsPath, expectedVersion = '') {
  let entries;
  try {
    entries = await fs.readdir(versionsPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeVersionGuid(entry.name)) continue;
    if (expectedVersion && entry.name !== expectedVersion) continue;
    const directory = path.join(versionsPath, entry.name);
    const executablePath = path.join(directory, PLAYER_EXECUTABLE);
    try {
      const [directoryInfo, executableInfo] = await Promise.all([fs.lstat(directory), fs.lstat(executablePath)]);
      if (!directoryInfo.isDirectory() || !executableInfo.isFile()) continue;
      candidates.push({
        versionGuid: entry.name,
        directory,
        executablePath,
        modifiedAt: directoryInfo.mtimeMs
      });
    } catch {
      // Ignore incomplete deployment folders while Roblox or its installer is updating.
    }
  }

  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0] || null;
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!response?.ok) throw new RobloxBootstrapperError(`Roblox version service returned HTTP ${response?.status || 'error'}.`, 'VERSION_CHECK_FAILED');
  return response.json();
}

async function getOfficialClientVersion(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new RobloxBootstrapperError('This Electron runtime does not provide secure network fetching.', 'FETCH_UNAVAILABLE');
  let lastError;
  for (const endpoint of DEPLOYMENT_ENDPOINTS) {
    try {
      return normalizeClientVersion(await fetchJson(endpoint, fetchImpl));
    } catch (error) {
      lastError = error;
    }
  }
  throw new RobloxBootstrapperError(`Could not reach Roblox's official Windows Player version service. ${lastError?.message || ''}`.trim(), 'VERSION_CHECK_FAILED');
}

async function assertPortableExecutable(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(2);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 2 || header[0] !== 0x4d || header[1] !== 0x5a) {
      throw new RobloxBootstrapperError('The official Roblox download was not a Windows executable.', 'INVALID_INSTALLER');
    }
  } finally {
    await handle.close();
  }
}

async function downloadOfficialInstaller(url, destination, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new RobloxBootstrapperError('This Electron runtime does not provide secure network fetching.', 'FETCH_UNAVAILABLE');
  let currentUrl = url;
  let response;

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (!isOfficialRobloxDownload(currentUrl)) {
      throw new RobloxBootstrapperError('Roblox installer download redirected outside official Roblox domains.', 'UNTRUSTED_DOWNLOAD');
    }
    response = await fetchImpl(currentUrl, {
      headers: { Accept: 'application/octet-stream,application/vnd.microsoft.portable-executable,*/*;q=0.8', 'User-Agent': ROBLOX_INSTALLER_USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new RobloxBootstrapperError('Roblox installer download returned an incomplete redirect.', 'DOWNLOAD_FAILED');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    break;
  }

  if (!response?.ok || !response.body) {
    throw new RobloxBootstrapperError(`Roblox installer download returned HTTP ${response?.status || 'error'}.`, 'DOWNLOAD_FAILED');
  }

  const declaredBytes = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_INSTALLER_BYTES) {
    throw new RobloxBootstrapperError('The official Roblox installer is larger than Eclipse allows.', 'DOWNLOAD_TOO_LARGE');
  }

  const temporaryPath = `${destination}.part`;
  let receivedBytes = 0;
  const byteLimit = new Transform({
    transform(chunk, encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_INSTALLER_BYTES) {
        callback(new RobloxBootstrapperError('The official Roblox installer is larger than Eclipse allows.', 'DOWNLOAD_TOO_LARGE'));
        return;
      }
      callback(null, chunk);
    }
  });

  try {
    await fs.rm(temporaryPath, { force: true });
    await pipeline(Readable.fromWeb(response.body), byteLimit, createWriteStream(temporaryPath, { flags: 'wx' }));
    await fs.rename(temporaryPath, destination);
    await assertPortableExecutable(destination);
    return { url: currentUrl, bytes: receivedBytes };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    await fs.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}

async function downloadOfficialInstallerWithFallback(versionGuid, destination, fetchImpl = globalThis.fetch) {
  const sources = [installerUrlFor(versionGuid), installerFallbackUrlFor(versionGuid)];
  let lastError;
  for (const source of sources) {
    try {
      return await downloadOfficialInstaller(source, destination, fetchImpl);
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : '';
  throw new RobloxBootstrapperError(`Roblox's official installer endpoints could not be downloaded.${detail}`, 'DOWNLOAD_FAILED');
}

function verifyAuthenticode(filePath, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const command = `$signature = Get-AuthenticodeSignature -LiteralPath '${escapePowerShellLiteral(filePath)}'; if ($signature.Status -eq 'Valid') { exit 0 } exit 1`;
    let child;
    try {
      child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'ignore' });
    } catch (error) {
      reject(new RobloxBootstrapperError(`Windows signature verification could not start. ${error.message}`, 'SIGNATURE_UNAVAILABLE'));
      return;
    }
    child.once('error', (error) => reject(new RobloxBootstrapperError(`Windows signature verification failed to start. ${error.message}`, 'SIGNATURE_UNAVAILABLE')));
    child.once('close', (code) => {
      if (code === 0) resolve(true);
      else reject(new RobloxBootstrapperError('Windows could not validate the official Roblox installer signature.', 'INVALID_SIGNATURE'));
    });
  });
}

function runInstaller(filePath, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(filePath, [], { windowsHide: true, stdio: 'ignore' });
    } catch (error) {
      reject(new RobloxBootstrapperError(`The official Roblox installer could not start. ${error.message}`, 'INSTALL_FAILED'));
      return;
    }
    child.once('error', (error) => reject(new RobloxBootstrapperError(`The official Roblox installer could not start. ${error.message}`, 'INSTALL_FAILED')));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new RobloxBootstrapperError(`The official Roblox installer exited with code ${code ?? 'unknown'}.`, 'INSTALL_FAILED'));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class RobloxBootstrapper extends EventEmitter {
  constructor({ platform = process.platform, env = process.env, fetchImpl = globalThis.fetch, spawnImpl = spawn, temporaryRoot = '', beforeInstall = async () => {} } = {}) {
    super();
    this.platform = platform;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.spawnImpl = spawnImpl;
    this.beforeInstall = typeof beforeInstall === 'function' ? beforeInstall : async () => {};
    this.versionsPath = robloxVersionsPath(env);
    this.temporaryRoot = temporaryRoot || path.join(os.tmpdir(), 'Eclipse', 'Roblox');
    this.operation = null;
    this.latest = null;
    this.lastError = '';
  }

  supported() {
    return this.platform === 'win32';
  }

  emitProgress(phase, detail = '') {
    this.emit('progress', { phase, detail, busy: !['ready', 'idle', 'error'].includes(phase) });
  }

  async inspect({ refresh = true } = {}) {
    if (!this.supported()) {
      return { supported: false, reason: 'Eclipse bootstrapper support is available from the Windows desktop app only.', installed: false, updateAvailable: false };
    }

    const installed = await locateRobloxPlayer(this.versionsPath);
    let latest = this.latest;
    let checkError = '';
    if (refresh) {
      try {
        latest = await getOfficialClientVersion(this.fetchImpl);
        this.latest = latest;
        this.lastError = '';
      } catch (error) {
        latest = null;
        checkError = error instanceof Error ? error.message : 'Eclipse could not check the official Roblox Player version.';
        this.lastError = checkError;
      }
    }

    return {
      supported: true,
      installed: Boolean(installed),
      installedVersion: installed?.versionGuid || '',
      installedDirectoryPresent: Boolean(installed?.directory),
      installedExecutablePresent: Boolean(installed?.executablePath),
      installedModifiedAt: installed?.modifiedAt ? new Date(installed.modifiedAt).toISOString() : '',
      latestVersion: latest?.versionGuid || '',
      latestClientVersion: latest?.version || '',
      updateAvailable: Boolean(latest && (!installed || installed.versionGuid !== latest.versionGuid)),
      checkError,
      managedLocation: this.versionsPath
    };
  }

  async status() {
    return this.inspect({ refresh: true });
  }

  async waitForInstalledVersion(versionGuid) {
    const endAt = Date.now() + INSTALL_TIMEOUT_MS;
    while (Date.now() < endAt) {
      const installed = await locateRobloxPlayer(this.versionsPath, versionGuid);
      if (installed) return installed;
      await delay(POLL_INTERVAL_MS);
    }
    return null;
  }

  async installOrUpdate({ force = false } = {}) {
    if (!this.supported()) throw new RobloxBootstrapperError('Eclipse bootstrapper support is available from the Windows desktop app only.', 'UNSUPPORTED_PLATFORM');
    if (this.operation) return this.operation;

    this.operation = (async () => {
      this.emitProgress('checking', 'Checking the official Roblox Windows Player release.');
      const latest = await getOfficialClientVersion(this.fetchImpl);
      this.latest = latest;
      const current = await locateRobloxPlayer(this.versionsPath);
      if (!force && current?.versionGuid === latest.versionGuid) {
        this.emitProgress('ready', 'The installed Roblox Player is current.');
        return { ...(await this.inspect({ refresh: false })), changed: false };
      }

      await this.beforeInstall({ current, latest, force });
      const installerPath = path.join(this.temporaryRoot, `${latest.versionGuid}-Roblox.exe`);
      try {
        await fs.mkdir(this.temporaryRoot, { recursive: true });
        await fs.rm(installerPath, { force: true });
        this.emitProgress('downloading', 'Downloading the signed official Roblox installer.');
        await downloadOfficialInstallerWithFallback(latest.versionGuid, installerPath, this.fetchImpl);
        this.emitProgress('verifying', 'Validating the Windows signature before installation.');
        await verifyAuthenticode(installerPath, this.spawnImpl);
        this.emitProgress('installing', 'Installing the official Roblox Player update.');
        await runInstaller(installerPath, this.spawnImpl);
        this.emitProgress('finalizing', 'Confirming the installed official Roblox Player version.');
        const installed = await this.waitForInstalledVersion(latest.versionGuid);
        if (!installed) {
          throw new RobloxBootstrapperError('Roblox installer finished, but Eclipse could not confirm the new Player version. Open Roblox once and try again.', 'INSTALL_NOT_CONFIRMED');
        }
        if (current?.directory && current.directory !== installed.directory) {
          try {
            await migrateManagedFlags(current.directory, installed.directory);
          } catch {
            // A malformed or locked ClientAppSettings file must not prevent a verified official Player update.
          }
        }
        this.emitProgress('ready', 'Official Roblox Player is ready.');
        return { ...(await this.inspect({ refresh: false })), changed: true };
      } finally {
        await fs.rm(installerPath, { force: true }).catch(() => {});
      }
    })();

    try {
      return await this.operation;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Roblox Player installation failed.';
      this.emitProgress('error', message);
      throw error;
    } finally {
      this.operation = null;
    }
  }

  async repair() {
    return this.installOrUpdate({ force: true });
  }

  async ensureReady() {
    if (!this.supported()) throw new RobloxBootstrapperError('Eclipse bootstrapper support is available from the Windows desktop app only.', 'UNSUPPORTED_PLATFORM');
    this.emitProgress('checking', 'Checking the installed Roblox Player.');
    const status = await this.inspect({ refresh: true });
    if (!status.installed) {
      if (!status.latestVersion) throw new RobloxBootstrapperError('Roblox Player is not installed and Eclipse could not reach the official installer service.', 'PLAYER_NOT_INSTALLED');
      return this.installOrUpdate();
    }
    if (status.updateAvailable) return this.installOrUpdate();
    if (status.checkError) {
      this.emitProgress('ready', 'Using the installed Roblox Player; the update check is unavailable.');
      return status;
    }
    this.emitProgress('ready', 'Installed Roblox Player is current.');
    return status;
  }
}

function createRobloxBootstrapper(options = {}) {
  return new RobloxBootstrapper(options);
}

module.exports = {
  DEPLOYMENT_ENDPOINTS,
  FALLBACK_INSTALLER_URL,
  MAX_INSTALLER_BYTES,
  OFFICIAL_INSTALLER_URL,
  PLAYER_EXECUTABLE,
  RobloxBootstrapper,
  RobloxBootstrapperError,
  createRobloxBootstrapper,
  getOfficialClientVersion,
  installerFallbackUrlFor,
  installerUrlFor,
  isOfficialRobloxDownload,
  isSafeVersionGuid,
  locateRobloxPlayer,
  normalizeClientVersion,
  robloxVersionsPath
};
