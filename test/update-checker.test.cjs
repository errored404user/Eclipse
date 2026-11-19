const assert = require('node:assert/strict');
const test = require('node:test');
const { compareVersions, createUpdateChecker, parseVersion } = require('../electron/update-checker.cjs');

test('compares Eclipse preview versions numerically', () => {
  assert.deepEqual(parseVersion('v0.1.0-preview.25'), { major: 0, minor: 1, patch: 0, preview: 25 });
  assert.equal(compareVersions('v0.1.0-preview.25', 'v0.1.0-preview.9'), 1);
  assert.equal(compareVersions('v0.1.0', 'v0.1.0-preview.99'), 1);
  assert.equal(parseVersion('latest'), null);
});

test('checks published GitHub releases without downloading or installing an update', async () => {
  const requested = [];
  const checker = createUpdateChecker({
    currentVersion: '0.1.0-preview.25',
    now: () => new Date('2026-11-19T16:00:00.000Z'),
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      return {
        ok: true,
        json: async () => [
          { tag_name: 'v0.1.0-preview.9', draft: false, published_at: '2026-11-18T10:00:00.000Z' },
          { tag_name: 'v0.1.0-preview.99', draft: true, published_at: '2026-11-19T17:00:00.000Z' },
          { tag_name: 'v0.1.0-preview.26', draft: false, published_at: '2026-11-19T16:00:00.000Z' },
          { tag_name: 'not-a-version', draft: false }
        ]
      };
    }
  });

  const status = await checker.check();
  assert.equal(requested.length, 1);
  assert.match(requested[0].url, /api\.github\.com\/repos\/errored404user\/Eclipse\/releases/);
  assert.equal(status.updateAvailable, true);
  assert.equal(status.latestVersion, 'v0.1.0-preview.26');
  assert.equal(status.releaseUrl, 'https://github.com/errored404user/Eclipse/releases/tag/v0.1.0-preview.26');
  assert.equal(requested[0].options.headers['User-Agent'], 'Eclipse/0.1.0-preview.25');
  assert.equal(status.checkedAt, '2026-11-19T16:00:00.000Z');
});

test('reports a release-check failure without throwing or claiming an update', async () => {
  const checker = createUpdateChecker({
    currentVersion: '0.1.0-preview.25',
    fetchImpl: async () => { throw new Error('network unavailable'); }
  });
  const status = await checker.check();
  assert.equal(status.updateAvailable, false);
  assert.match(status.reason, /Could not check GitHub releases/);
});
