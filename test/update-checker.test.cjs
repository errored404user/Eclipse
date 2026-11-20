const assert = require('node:assert/strict');
const test = require('node:test');
const { compareVersions, createUpdateChecker, parseVersion } = require('../electron/update-checker.cjs');

test('compares stable Eclipse v2 releases and older preview versions numerically', () => {
  assert.deepEqual(parseVersion('v0.1.0-preview.25'), { major: 0, minor: 1, patch: 0, preview: 25 });
  assert.deepEqual(parseVersion('v2.0.0'), { major: 2, minor: 0, patch: 0, preview: Infinity });
  assert.equal(compareVersions('v0.1.0-preview.25', 'v0.1.0-preview.9'), 1);
  assert.equal(compareVersions('v0.1.0', 'v0.1.0-preview.99'), 1);
  assert.equal(compareVersions('v2.0.0', 'v0.1.0-preview.35'), 1);
  assert.equal(compareVersions('v2.0.1', 'v2.0.0'), 1);
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


test('explains when GitHub does not expose a public release feed', async () => {
  const checker = createUpdateChecker({
    currentVersion: '0.1.0-preview.27',
    fetchImpl: async () => ({ ok: false, status: 404 })
  });
  const status = await checker.check();
  assert.equal(status.updateAvailable, false);
  assert.match(status.reason, /did not expose a public Eclipse release feed/);
  assert.match(status.reason, /will not use an embedded account token/);
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

test('marks Eclipse v2 as the stable installer release', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-windows-exe.yml'), 'utf8');
  assert.equal(packageJson.version, '2.0.0');
  assert.match(shell, /class="release-badge"[^>]*>v2<\/span>/);
  assert.doesNotMatch(shell, />Preview<\/span>/);
  assert.match(workflow, /gh release create .*--generate-notes/);
  assert.doesNotMatch(workflow, /--prerelease/);
});
