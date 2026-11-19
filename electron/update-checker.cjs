const { EventEmitter } = require('node:events');

const RELEASES_URL = 'https://api.github.com/repos/errored404user/Eclipse/releases?per_page=100';
const RELEASES_PAGE = 'https://github.com/errored404user/Eclipse/releases';
const REQUEST_TIMEOUT_MS = 10_000;

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/i.exec(String(value || '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preview: match[4] === undefined ? Number.POSITIVE_INFINITY : Number(match[4])
  };
}

function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left;
  const b = typeof right === 'string' ? parseVersion(right) : right;
  if (!a || !b) return 0;
  for (const key of ['major', 'minor', 'patch', 'preview']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  return 0;
}

function releaseUrl(tag) {
  return `${RELEASES_PAGE}/tag/${encodeURIComponent(tag)}`;
}

function normalizeRelease(value) {
  if (!value || value.draft === true) return null;
  const tag = String(value.tag_name || '').trim();
  const version = parseVersion(tag);
  if (!tag || !version) return null;
  return {
    tag,
    version,
    publishedAt: typeof value.published_at === 'string' ? value.published_at : '',
    releaseUrl: releaseUrl(tag)
  };
}

function statusFor(currentVersion, fields = {}) {
  return {
    supported: true,
    currentVersion: String(currentVersion || ''),
    checking: false,
    checkedAt: '',
    updateAvailable: false,
    latestVersion: '',
    releaseUrl: RELEASES_PAGE,
    reason: '',
    ...fields
  };
}

class UpdateChecker extends EventEmitter {
  constructor({ currentVersion, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
    super();
    this.currentVersion = String(currentVersion || '');
    this.current = parseVersion(this.currentVersion);
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.status = statusFor(this.currentVersion, this.current ? {} : { supported: false, reason: 'This Eclipse build has no comparable version metadata.' });
    this.pending = null;
  }

  getStatus() {
    return { ...this.status };
  }

  publish(next) {
    this.status = statusFor(this.currentVersion, next);
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  async check() {
    if (!this.status.supported) return this.getStatus();
    if (this.pending) return this.pending;
    this.publish({ ...this.status, checking: true, reason: '' });
    this.pending = (async () => {
      try {
        if (typeof this.fetchImpl !== 'function') throw new Error('Update checking is not available in this Eclipse runtime.');
        const response = await this.fetchImpl(RELEASES_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `Eclipse/${this.currentVersion || 'desktop'}`
          },
          signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined
        });
        if (!response?.ok) throw new Error(`GitHub responded with ${response?.status || 'an unknown error'}.`);
        const payload = await response.json();
        const latest = (Array.isArray(payload) ? payload : [])
          .map(normalizeRelease)
          .filter(Boolean)
          .sort((left, right) => compareVersions(right.version, left.version))[0];
        const checkedAt = this.now().toISOString();
        if (!latest) return this.publish({ checkedAt, reason: 'No published Eclipse release was found.' });
        const updateAvailable = compareVersions(latest.version, this.current) > 0;
        return this.publish({
          checkedAt,
          updateAvailable,
          latestVersion: latest.tag,
          releaseUrl: latest.releaseUrl,
          reason: updateAvailable ? `A newer Eclipse build, ${latest.tag}, is available on GitHub.` : 'Eclipse is up to date with the latest published GitHub release.'
        });
      } catch (error) {
        return this.publish({
          checkedAt: this.now().toISOString(),
          reason: `Could not check GitHub releases. ${error instanceof Error ? error.message : 'Try again later.'}`
        });
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
}

function createUpdateChecker(options) {
  return new UpdateChecker(options);
}

module.exports = {
  RELEASES_PAGE,
  RELEASES_URL,
  UpdateChecker,
  compareVersions,
  createUpdateChecker,
  normalizeRelease,
  parseVersion
};
