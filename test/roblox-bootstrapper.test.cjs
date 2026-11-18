const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createRobloxBootstrapper,
  installerUrlFor,
  isOfficialRobloxDownload,
  isSafeVersionGuid,
  locateRobloxPlayer,
  normalizeClientVersion,
  robloxVersionsPath
} = require('../electron/roblox-bootstrapper.cjs');
const { migrateManagedFlags } = require('../electron/fast-flags.cjs');

const oldVersion = 'version-aaaaaaaa';
const latestVersion = 'version-bbbbbbbb';

async function createPlayer(versionsPath, versionGuid, settings = null) {
  const directory = path.join(versionsPath, versionGuid);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'RobloxPlayerBeta.exe'), 'MZ test player');
  if (settings) {
    const settingsDirectory = path.join(directory, 'ClientSettings');
    await fs.mkdir(settingsDirectory, { recursive: true });
    await fs.writeFile(path.join(settingsDirectory, 'ClientAppSettings.json'), `${JSON.stringify(settings)}\n`);
  }
  return directory;
}

async function withTemporaryRoblox(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eclipse-bootstrapper-test-'));
  const env = { LOCALAPPDATA: root };
  try {
    await run({ root, env, versionsPath: robloxVersionsPath(env) });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('validates official Windows Player version data and installer origins', () => {
  assert.equal(isSafeVersionGuid(latestVersion), true);
  assert.equal(isSafeVersionGuid('version-../../outside'), false);
  assert.equal(normalizeClientVersion({ clientVersionUpload: latestVersion, version: '0.1.2.3' }).versionGuid, latestVersion);
  assert.throws(() => normalizeClientVersion({ clientVersionUpload: '../not-a-version' }), { code: 'INVALID_VERSION' });
  assert.equal(installerUrlFor(latestVersion), `https://setup.rbxcdn.com/${latestVersion}-Roblox.exe`);
  assert.equal(isOfficialRobloxDownload('https://setup.rbxcdn.com/file.exe'), true);
  assert.equal(isOfficialRobloxDownload('https://www.roblox.com/download/client?os=win'), true);
  assert.equal(isOfficialRobloxDownload('https://evil.example/Roblox.exe'), false);
  assert.equal(isOfficialRobloxDownload('https://untrusted.rbxcdn.com/file.exe'), false);
  assert.equal(isOfficialRobloxDownload('http://setup.rbxcdn.com/file.exe'), false);
});

test('detects the current installed Windows Roblox Player and compares it to the official release', async () => {
  await withTemporaryRoblox(async ({ env, versionsPath }) => {
    await createPlayer(versionsPath, oldVersion);
    const latestDirectory = await createPlayer(versionsPath, latestVersion);
    await fs.utimes(latestDirectory, new Date(), new Date(Date.now() + 1_000));
    const client = await locateRobloxPlayer(versionsPath);
    assert.equal(client.versionGuid, latestVersion);
    const bootstrapper = createRobloxBootstrapper({
      platform: 'win32',
      env,
      fetchImpl: async () => new Response(JSON.stringify({ clientVersionUpload: latestVersion, version: '0.1.2.3' }), { status: 200, headers: { 'content-type': 'application/json' } })
    });
    const status = await bootstrapper.status();
    assert.equal(status.supported, true);
    assert.equal(status.installed, true);
    assert.equal(status.installedVersion, latestVersion);
    assert.equal(status.latestVersion, latestVersion);
    assert.equal(status.updateAvailable, false);
  });
});

test('updates only through the official installer path, validates its signature, and migrates Eclipse-managed flags', async () => {
  await withTemporaryRoblox(async ({ root, env, versionsPath }) => {
    await createPlayer(versionsPath, oldVersion, {
      FIntDebugForceMSAASamples: '4',
      FFlagUnrelatedSetting: 'keep out of migration'
    });
    const progress = [];
    const spawnImpl = (command) => {
      const child = new EventEmitter();
      process.nextTick(async () => {
        if (command !== 'powershell.exe') await createPlayer(versionsPath, latestVersion, { FFlagTargetSetting: 'keep' });
        child.emit('close', 0);
      });
      return child;
    };
    const bootstrapper = createRobloxBootstrapper({
      platform: 'win32',
      env,
      temporaryRoot: path.join(root, 'EclipseDownload'),
      spawnImpl,
      fetchImpl: async (url) => {
        if (String(url).includes('/v2/client-version/WindowsPlayer')) {
          return new Response(JSON.stringify({ clientVersionUpload: latestVersion, version: '0.1.2.3' }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        assert.equal(url, installerUrlFor(latestVersion));
        return new Response(Buffer.from('MZ signed official installer'), { status: 200, headers: { 'content-length': '28' } });
      }
    });
    bootstrapper.on('progress', (update) => progress.push(update.phase));
    const result = await bootstrapper.installOrUpdate();
    assert.equal(result.changed, true);
    assert.equal(result.installedVersion, latestVersion);
    assert.deepEqual(progress, ['checking', 'downloading', 'verifying', 'installing', 'finalizing', 'ready']);

    const migrated = JSON.parse(await fs.readFile(path.join(versionsPath, latestVersion, 'ClientSettings', 'ClientAppSettings.json'), 'utf8'));
    assert.equal(migrated.FIntDebugForceMSAASamples, '4');
    assert.equal(migrated.FFlagTargetSetting, 'keep');
    assert.equal(migrated.FFlagUnrelatedSetting, undefined);
    await assert.rejects(fs.access(path.join(root, 'EclipseDownload', `${latestVersion}-Roblox.exe`)));
  });
});

test('moves only Eclipse-managed Fast Flags into a new official Player folder', async () => {
  await withTemporaryRoblox(async ({ versionsPath }) => {
    const source = await createPlayer(versionsPath, oldVersion, {
      DFIntTaskSchedulerTargetFps: '144',
      FFlagUnrelatedSetting: 'do not copy'
    });
    const target = await createPlayer(versionsPath, latestVersion, { FFlagTargetSetting: 'keep' });
    const migrated = await migrateManagedFlags(source, target);
    assert.deepEqual(migrated, { DFIntTaskSchedulerTargetFps: '144' });
    const settings = JSON.parse(await fs.readFile(path.join(target, 'ClientSettings', 'ClientAppSettings.json'), 'utf8'));
    assert.deepEqual(settings, { FFlagTargetSetting: 'keep', DFIntTaskSchedulerTargetFps: '144' });
  });
});
