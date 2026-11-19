const fs = require('node:fs/promises');
const path = require('node:path');
const { isRobloxPlayerRunning } = require('./player-mods.cjs');

const ROBLOX_CACHE_DIRECTORIES = Object.freeze(['http', 'logs']);
const MAX_CACHE_SCAN_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_SCAN_ENTRIES = 20_000;

class OptimizationError extends Error {
  constructor(message, code = 'OPTIMIZATION_ERROR') {
    super(message);
    this.name = 'OptimizationError';
    this.code = code;
  }
}

function isPathInside(rootDirectory, candidate) {
  const relative = path.relative(rootDirectory, candidate);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function directorySize(directory, { maxBytes = MAX_CACHE_SCAN_BYTES, maxEntries = MAX_CACHE_SCAN_ENTRIES } = {}) {
  let bytes = 0;
  let entriesSeen = 0;
  let truncated = false;
  const root = path.resolve(directory);
  async function walk(candidate) {
    if (bytes >= maxBytes || entriesSeen >= maxEntries) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(candidate, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (bytes >= maxBytes || entriesSeen >= maxEntries) {
        truncated = true;
        return;
      }
      entriesSeen += 1;
      if (entry.isSymbolicLink()) continue;
      const child = path.join(candidate, entry.name);
      if (!isPathInside(root, child)) continue;
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const info = await fs.lstat(child);
        if (info.isFile() && !info.isSymbolicLink()) bytes = Math.min(maxBytes, bytes + info.size);
      } catch {
        // A cache file can legitimately disappear while it is being inspected.
      }
    }
  }
  await walk(root);
  return { bytes, truncated };
}

function normalizeWindowsPath(value) {
  return typeof value === 'string' && value.trim() ? path.resolve(value) : '';
}

class Optimization {
  constructor({ platform = process.platform, userDataRoot = '', localAppData = process.env.LOCALAPPDATA || '', isPlayerRunning = null } = {}) {
    this.platform = platform;
    this.userDataRoot = normalizeWindowsPath(userDataRoot);
    this.localAppData = normalizeWindowsPath(localAppData);
    this.isPlayerRunning = isPlayerRunning || (() => isRobloxPlayerRunning({ platform }));
  }

  supported() {
    return this.platform === 'win32';
  }

  robloxRoot() {
    if (!this.localAppData) return '';
    return path.join(this.localAppData, 'Roblox');
  }

  cacheDirectories() {
    const root = this.robloxRoot();
    if (!root) return [];
    return ROBLOX_CACHE_DIRECTORIES.map((name) => path.join(root, name));
  }

  async status() {
    if (!this.supported()) {
      return { supported: false, playerRunning: false, robloxCacheBytes: 0, robloxCacheTruncated: false, reason: 'Optimization tools are available in the Windows Eclipse desktop app only.' };
    }
    let playerRunning = true;
    try {
      playerRunning = await this.isPlayerRunning();
    } catch {
      playerRunning = true;
    }
    let robloxCacheBytes = 0;
    let robloxCacheTruncated = false;
    try {
      for (const directory of this.cacheDirectories()) {
        const size = await directorySize(directory);
        robloxCacheBytes = Math.min(MAX_CACHE_SCAN_BYTES, robloxCacheBytes + size.bytes);
        robloxCacheTruncated ||= size.truncated || robloxCacheBytes >= MAX_CACHE_SCAN_BYTES;
      }
    } catch {
      // Cache sizing is informational and must never prevent the workspace from loading.
    }
    return {
      supported: true,
      playerRunning,
      robloxCacheBytes,
      robloxCacheTruncated,
      reason: playerRunning ? 'Close Roblox Player before Eclipse clears its local cache and logs.' : ''
    };
  }

  async clearRobloxCache() {
    if (!this.supported()) throw new OptimizationError('Roblox cache cleanup is available in the Windows Eclipse desktop app only.', 'UNSUPPORTED_PLATFORM');
    if (await this.isPlayerRunning()) throw new OptimizationError('Close Roblox Player before Eclipse clears its local cache and logs.', 'PLAYER_RUNNING');
    const root = this.robloxRoot();
    if (!root) throw new OptimizationError('Windows local app data is unavailable, so Eclipse cannot locate the Roblox cache.', 'CACHE_UNAVAILABLE');
    let cleared = 0;
    for (const directory of this.cacheDirectories()) {
      if (!isPathInside(root, directory)) throw new OptimizationError('Eclipse rejected an unsafe Roblox cache location.', 'UNSAFE_PATH');
      try {
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 2 });
        cleared += 1;
      } catch (error) {
        throw new OptimizationError(`Eclipse could not clear the Roblox cache. ${error.message}`, 'CACHE_CLEAR_FAILED');
      }
    }
    return { ...(await this.status()), cleared };
  }
}

function createOptimization(options = {}) {
  return new Optimization(options);
}

module.exports = {
  MAX_CACHE_SCAN_BYTES,
  Optimization,
  OptimizationError,
  createOptimization,
  directorySize
};
