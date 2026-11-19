const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createOptimization } = require('../electron/optimization.cjs');

test('clears only the bounded Roblox local cache and logs while Player is closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eclipse-optimization-test-'));
  try {
    const localAppData = path.join(root, 'LocalAppData');
    const robloxRoot = path.join(localAppData, 'Roblox');
    await fs.mkdir(path.join(robloxRoot, 'http', 'nested'), { recursive: true });
    await fs.mkdir(path.join(robloxRoot, 'logs'), { recursive: true });
    await fs.mkdir(path.join(robloxRoot, 'Versions'), { recursive: true });
    await fs.writeFile(path.join(robloxRoot, 'http', 'nested', 'cache.bin'), Buffer.alloc(1536));
    await fs.writeFile(path.join(robloxRoot, 'logs', 'player.log'), Buffer.alloc(512));
    await fs.writeFile(path.join(robloxRoot, 'Versions', 'keep.txt'), 'do not remove');

    const optimization = createOptimization({ platform: 'win32', localAppData, isPlayerRunning: async () => false });
    const before = await optimization.status();
    assert.equal(before.supported, true);
    assert.equal(before.playerRunning, false);
    assert.equal(before.robloxCacheBytes, 2048);

    const result = await optimization.clearRobloxCache();
    assert.equal(result.cleared, 2);
    assert.equal(result.robloxCacheBytes, 0);
    await assert.rejects(() => fs.stat(path.join(robloxRoot, 'http')), { code: 'ENOENT' });
    await assert.rejects(() => fs.stat(path.join(robloxRoot, 'logs')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(robloxRoot, 'Versions', 'keep.txt'), 'utf8'), 'do not remove');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('refuses Roblox cache cleanup while Player is running', async () => {
  const optimization = createOptimization({ platform: 'win32', localAppData: os.tmpdir(), isPlayerRunning: async () => true });
  await assert.rejects(() => optimization.clearRobloxCache(), { code: 'PLAYER_RUNNING' });
});

test('keeps optimization controls Windows-only', async () => {
  const optimization = createOptimization({ platform: 'linux', localAppData: os.tmpdir(), isPlayerRunning: async () => false });
  const status = await optimization.status();
  assert.equal(status.supported, false);
  await assert.rejects(() => optimization.clearRobloxCache(), { code: 'UNSUPPORTED_PLATFORM' });
});
