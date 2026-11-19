const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPlayerMods, normalizeManifest, readZipEntries } = require('../electron/player-mods.cjs');

const versionGuid = 'version-modpack1234';
const pngOriginal = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const pngReplacement = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02]);
const oggReplacement = Buffer.from('OggS eclipse player pack', 'ascii');

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(Buffer.concat([local, filename, data]));
    centrals.push(Buffer.concat([central, filename]));
    offset += local.length + filename.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function manifest(id = 'violet-interface') {
  return {
    schema: 'eclipse-player-pack/v1',
    id,
    name: 'Violet Interface',
    version: '1.0.0',
    description: 'A local visual and audio test pack.',
    assets: [
      { source: 'assets/interface.png', target: 'content/textures/interface.png', kind: 'texture' },
      { source: 'assets/launch.ogg', target: 'content/sounds/launch.ogg', kind: 'sound' }
    ]
  };
}

async function fixture({ playerRunning = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eclipse-player-mods-test-'));
  const playerDirectory = path.join(root, 'Roblox', 'Versions', versionGuid);
  await fs.mkdir(path.join(playerDirectory, 'content', 'textures'), { recursive: true });
  await fs.mkdir(path.join(playerDirectory, 'content', 'sounds'), { recursive: true });
  await fs.writeFile(path.join(playerDirectory, 'content', 'textures', 'interface.png'), pngOriginal);
  await fs.writeFile(path.join(playerDirectory, 'content', 'sounds', 'launch.ogg'), Buffer.from('OggS original player sound', 'ascii'));
  const player = { versionGuid, directory: playerDirectory, executablePath: path.join(playerDirectory, 'RobloxPlayerBeta.exe') };
  const mods = createPlayerMods({
    platform: 'win32',
    storageRoot: path.join(root, 'Eclipse', 'PlayerMods'),
    locatePlayer: async () => player,
    isPlayerRunning: async () => playerRunning
  });
  return { root, player, mods };
}

async function createFolderPack(root, id = 'violet-interface') {
  const folder = path.join(root, 'pack-folder');
  const data = manifest(id);
  await fs.mkdir(path.join(folder, 'assets'), { recursive: true });
  await fs.writeFile(path.join(folder, 'manifest.json'), `${JSON.stringify(data, null, 2)}\n`);
  await fs.writeFile(path.join(folder, 'assets', 'interface.png'), pngReplacement);
  await fs.writeFile(path.join(folder, 'assets', 'launch.ogg'), oggReplacement);
  return folder;
}

test('imports a manifest folder, applies declared visual/audio assets, and restores versioned backups', async () => {
  const { root, player, mods } = await fixture();
  try {
    const folder = await createFolderPack(root);
    const imported = await mods.importFolder(folder);
    assert.equal(imported.packs.length, 1);
    assert.equal(imported.packs[0].enabled, false);
    assert.equal(imported.packs[0].assets.length, 2);

    const enabled = await mods.setEnabled('violet-interface', true);
    assert.equal(enabled.packs[0].enabled, true);
    assert.deepEqual(await fs.readFile(path.join(player.directory, 'content', 'textures', 'interface.png')), pngReplacement);
    assert.deepEqual(await fs.readFile(path.join(player.directory, 'content', 'sounds', 'launch.ogg')), oggReplacement);

    const disabled = await mods.setEnabled('violet-interface', false);
    assert.equal(disabled.packs[0].enabled, false);
    assert.deepEqual(await fs.readFile(path.join(player.directory, 'content', 'textures', 'interface.png')), pngOriginal);
    assert.deepEqual(await fs.readFile(path.join(player.directory, 'content', 'sounds', 'launch.ogg')), Buffer.from('OggS original player sound', 'ascii'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('disables and restores local packs for review before an official Player update', async () => {
  const { root, player, mods } = await fixture();
  try {
    await mods.importFolder(await createFolderPack(root));
    await mods.setEnabled('violet-interface', true);
    const result = await mods.prepareForPlayerUpdate({ current: player });
    assert.equal(result.changed, true);
    const status = await mods.status();
    assert.equal(status.packs[0].enabled, false);
    assert.equal(status.packs[0].needsReview, true);
    assert.deepEqual(await fs.readFile(path.join(player.directory, 'content', 'textures', 'interface.png')), pngOriginal);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('builds a shareable .eclipsepack from selected creator assets and imports it locally', async () => {
  const { root, mods } = await fixture();
  try {
    const folder = await createFolderPack(root, 'creator-pack');
    const destination = path.join(root, 'creator-pack.eclipsepack');
    const created = await mods.createPackage({
      manifest: manifest('creator-pack'),
      assetFiles: new Map([
        ['assets/interface.png', path.join(folder, 'assets', 'interface.png')],
        ['assets/launch.ogg', path.join(folder, 'assets', 'launch.ogg')]
      ]),
      destination
    });
    assert.deepEqual(created, { id: 'creator-pack', name: 'Violet Interface', version: '1.0.0', assets: 2 });
    assert.equal(readZipEntries(await fs.readFile(destination)).size, 3);
    const status = await mods.importPackage(destination);
    assert.equal(status.packs[0].id, 'creator-pack');
    assert.equal(status.packs[0].assets.length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('imports a bounded .eclipsepack archive and rejects non-allowlisted targets', async () => {
  const { root, mods } = await fixture();
  try {
    const packManifest = manifest('zip-player-pack');
    const archive = storedZip([
      ['manifest.json', JSON.stringify(packManifest)],
      ['assets/interface.png', pngReplacement],
      ['assets/launch.ogg', oggReplacement]
    ]);
    assert.equal(readZipEntries(archive).size, 3);
    const packagePath = path.join(root, 'violet.eclipsepack');
    await fs.writeFile(packagePath, archive);
    const imported = await mods.importPackage(packagePath);
    assert.equal(imported.packs[0].id, 'zip-player-pack');
    assert.throws(() => normalizeManifest({ ...packManifest, assets: [{ source: 'assets/unsafe.png', target: 'content/scripts/unsafe.png', kind: 'texture' }] }), { code: 'INVALID_MANIFEST' });
    assert.throws(() => normalizeManifest({ ...packManifest, assets: [{ source: '../unsafe.png', target: 'content/textures/unsafe.png', kind: 'texture' }] }), { code: 'INVALID_MANIFEST' });
    assert.throws(() => normalizeManifest({ ...packManifest, assets: [{ source: 'assets/unsafe:stream.png', target: 'content/textures/unsafe.png', kind: 'texture' }] }), { code: 'INVALID_MANIFEST' });
    assert.throws(() => normalizeManifest({ ...packManifest, assets: [
      { source: 'assets/Interface.png', target: 'content/textures/one.png', kind: 'texture' },
      { source: 'assets/interface.png', target: 'content/textures/two.png', kind: 'texture' }
    ] }), { code: 'INVALID_MANIFEST' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('fails closed while Player is running and never changes a live Player folder', async () => {
  const { root, player, mods } = await fixture({ playerRunning: true });
  try {
    await mods.importFolder(await createFolderPack(root));
    await assert.rejects(() => mods.setEnabled('violet-interface', true), { code: 'PLAYER_RUNNING' });
    assert.deepEqual(await fs.readFile(path.join(player.directory, 'content', 'textures', 'interface.png')), pngOriginal);
    assert.equal((await mods.status()).packs[0].enabled, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('blocks folder symlinks that leave the manifest directory and mismatched asset signatures', async () => {
  const { root, mods } = await fixture();
  try {
    const folder = await createFolderPack(root);
    const assetPath = path.join(folder, 'assets', 'interface.png');
    const outside = path.join(root, 'outside.png');
    await fs.writeFile(outside, pngReplacement);
    await fs.rm(assetPath);
    await fs.symlink(outside, assetPath);
    await assert.rejects(() => mods.importFolder(folder), { code: 'INVALID_PACKAGE' });

    const invalidFolder = path.join(root, 'invalid-pack');
    const invalidManifest = manifest('wrong-signature');
    await fs.mkdir(path.join(invalidFolder, 'assets'), { recursive: true });
    await fs.writeFile(path.join(invalidFolder, 'manifest.json'), JSON.stringify(invalidManifest));
    await fs.writeFile(path.join(invalidFolder, 'assets', 'interface.png'), oggReplacement);
    await fs.writeFile(path.join(invalidFolder, 'assets', 'launch.ogg'), oggReplacement);
    await assert.rejects(() => mods.importFolder(invalidFolder), { code: 'INVALID_ASSET' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rejects a Player asset path that resolves through a symlink outside the Player version', async () => {
  const { root, player, mods } = await fixture();
  try {
    await mods.importFolder(await createFolderPack(root));
    const texturesDirectory = path.join(player.directory, 'content', 'textures');
    const outsideDirectory = path.join(root, 'outside-textures');
    await fs.mkdir(outsideDirectory, { recursive: true });
    await fs.writeFile(path.join(outsideDirectory, 'interface.png'), pngOriginal);
    await fs.rm(texturesDirectory, { recursive: true, force: true });
    await fs.symlink(outsideDirectory, texturesDirectory);
    await assert.rejects(() => mods.setEnabled('violet-interface', true), { code: 'INVALID_TARGET' });
    assert.deepEqual(await fs.readFile(path.join(outsideDirectory, 'interface.png')), pngOriginal);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('does not permit archive traversal or a cumulative archive expansion beyond the asset budget', async () => {
  const traversal = storedZip([['../manifest.json', '{}']]);
  assert.throws(() => readZipEntries(traversal), { code: 'INVALID_PACKAGE' });

  const { root, mods } = await fixture();
  try {
    const bombManifest = manifest('bounded-archive');
    bombManifest.assets = Array.from({ length: 4 }, (_, index) => ({
      source: `assets/texture-${index}.png`,
      target: `content/textures/texture-${index}.png`,
      kind: 'texture'
    }));
    const archive = storedZip([
      ['manifest.json', JSON.stringify(bombManifest)],
      ...bombManifest.assets.map((asset) => [asset.source, pngReplacement])
    ]);
    const eocdOffset = archive.length - 22;
    const centralOffset = archive.readUInt32LE(eocdOffset + 16);
    let offset = centralOffset;
    for (let index = 0; index < 5; index += 1) {
      const nameLength = archive.readUInt16LE(offset + 28);
      if (index > 0) archive.writeUInt32LE(8 * 1024 * 1024, offset + 24);
      offset += 46 + nameLength;
    }
    const packagePath = path.join(root, 'oversized.eclipsepack');
    await fs.writeFile(packagePath, archive);
    await assert.rejects(() => mods.importPackage(packagePath), { code: 'INVALID_PACKAGE' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('keeps existing packs enabled when a conflicting pack is rejected', async () => {
  const { root, player, mods } = await fixture();
  try {
    await mods.importFolder(await createFolderPack(root, 'first-pack'));
    await mods.setEnabled('first-pack', true);
    await mods.importFolder(await createFolderPack(root, 'second-pack'));
    await assert.rejects(() => mods.setEnabled('second-pack', true), { code: 'TARGET_CONFLICT' });
    const status = await mods.status();
    assert.equal(status.packs.find((pack) => pack.id === 'first-pack').enabled, true);
    assert.equal(status.packs.find((pack) => pack.id === 'second-pack').enabled, false);
    assert.deepEqual(await fs.readFile(path.join(player.directory, 'content', 'textures', 'interface.png')), pngReplacement);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('fails closed when local state or a versioned backup index is damaged', async () => {
  const { root, player, mods } = await fixture();
  try {
    await mods.importFolder(await createFolderPack(root));
    await mods.setEnabled('violet-interface', true);
    await fs.writeFile(mods.paths().state, '{not valid json');
    await assert.rejects(() => mods.restoreActive(), { code: 'INVALID_STATE' });
    assert.deepEqual(await fs.readFile(path.join(player.directory, 'content', 'textures', 'interface.png')), pngReplacement);

    const backupIndex = path.join(mods.backupDirectory(versionGuid), 'index.json');
    await fs.writeFile(mods.paths().state, JSON.stringify({
      schema: 'eclipse-player-mods/v1',
      packs: [{
        ...manifest(),
        assetMetadata: {
          'assets/interface.png': { mime: 'image/png', size: pngReplacement.length },
          'assets/launch.ogg': { mime: 'audio/ogg', size: oggReplacement.length }
        },
        enabled: true,
        needsReview: false,
        importedAt: new Date().toISOString(),
        lastAppliedVersion: versionGuid,
        lastError: ''
      }]
    }));
    await fs.writeFile(backupIndex, '{not valid json');
    await assert.rejects(() => mods.restoreActive(), { code: 'BACKUP_READ_FAILED' });
    assert.deepEqual(await fs.readFile(path.join(player.directory, 'content', 'textures', 'interface.png')), pngReplacement);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
