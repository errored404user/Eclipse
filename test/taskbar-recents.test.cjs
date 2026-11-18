const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { normalizeRecentPlaceIds, readRecentPlaceIds, writeRecentPlaceIds } = require('../electron/taskbar-recents.cjs');

test('keeps a bounded, local-only list of valid place IDs for Taskbar handoffs', async () => {
  assert.deepEqual(normalizeRecentPlaceIds([1818, '42', 1818, 0, -1, 'bad']), [1818, 42]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eclipse-taskbar-recents-test-'));
  const destination = path.join(directory, 'taskbar-recent-places.json');
  try {
    await writeRecentPlaceIds(destination, [1818, 42, 1818]);
    assert.deepEqual(await readRecentPlaceIds(destination), [1818, 42]);
    const saved = JSON.parse(await fs.readFile(destination, 'utf8'));
    assert.deepEqual(saved, { placeIds: [1818, 42] });
    await fs.writeFile(destination, '{invalid json', 'utf8');
    assert.deepEqual(await readRecentPlaceIds(destination), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
