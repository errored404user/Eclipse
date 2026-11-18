const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PROFILE_FLAGS = {
  default: {},
  performance: {
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: '0',
    FIntDebugForceMSAASamples: '1'
  },
  balanced: {
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: '2',
    FIntDebugForceMSAASamples: '2'
  },
  quality: {
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: '3',
    FIntDebugForceMSAASamples: '4'
  }
};

const MANAGED_KEYS = Object.freeze([
  'DFFlagTextureQualityOverrideEnabled',
  'DFIntTextureQualityOverride',
  'FIntDebugForceMSAASamples',
  'DFIntTaskSchedulerTargetFps',
  'DFFlagDisableDPIScale'
]);

const FPS_CAPS = Object.freeze([60, 120, 144, 165, 240]);

function normalizeOptions(options = {}) {
  const profile = Object.hasOwn(PROFILE_FLAGS, options.profile) ? options.profile : 'default';
  const requestedCap = Number(options.fpsCap);
  return {
    profile,
    fpsCap: FPS_CAPS.includes(requestedCap) ? requestedCap : 0,
    disableDpiScaling: options.disableDpiScaling === true
  };
}

function buildManagedFlags(options = {}) {
  const normalized = normalizeOptions(options);
  const flags = { ...PROFILE_FLAGS[normalized.profile] };
  if (normalized.fpsCap) flags.DFIntTaskSchedulerTargetFps = String(normalized.fpsCap);
  if (normalized.disableDpiScaling) flags.DFFlagDisableDPIScale = 'True';
  return flags;
}

function mergeManagedFlags(existing, managed) {
  const next = { ...existing };
  for (const key of MANAGED_KEYS) delete next[key];
  return { ...next, ...managed };
}

async function locateRobloxPlayer() {
  if (process.platform !== 'win32') return null;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const versionsPath = path.join(localAppData, 'Roblox', 'Versions');
  try {
    const entries = await fs.readdir(versionsPath, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(versionsPath, entry.name);
      const executable = path.join(directory, 'RobloxPlayerBeta.exe');
      try {
        const [file, folder] = await Promise.all([fs.stat(executable), fs.stat(directory)]);
        if (file.isFile()) candidates.push({ directory, modified: folder.mtimeMs });
      } catch {
        // Ignore stale or incomplete Roblox version folders.
      }
    }
    candidates.sort((left, right) => right.modified - left.modified);
    return candidates[0]?.directory ?? null;
  } catch {
    return null;
  }
}

async function readSettings(settingsPath) {
  try {
    const text = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('ClientAppSettings.json must contain a JSON object.');
    }
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) throw new Error('Existing ClientAppSettings.json is invalid JSON. Eclipse left it unchanged.');
    throw error;
  }
}

async function writeSettings(settingsPath, settings) {
  const directory = path.dirname(settingsPath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.eclipse-${randomUUID()}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, settingsPath);
}

async function getStatus() {
  if (process.platform !== 'win32') {
    return { supported: false, reason: 'Fast Flags can be applied from the Windows Eclipse app only.' };
  }
  const playerDirectory = await locateRobloxPlayer();
  if (!playerDirectory) {
    return { supported: false, reason: 'Roblox Player was not found. Install and launch Roblox Player once, then try again.' };
  }
  const settingsPath = path.join(playerDirectory, 'ClientSettings', 'ClientAppSettings.json');
  const settings = await readSettings(settingsPath);
  const managedFlags = Object.fromEntries(MANAGED_KEYS.filter((key) => typeof settings[key] === 'string').map((key) => [key, settings[key]]));
  return { supported: true, playerDirectory, settingsPath, managedFlags };
}

async function apply(options) {
  const status = await getStatus();
  if (!status.supported) throw new Error(status.reason);
  const existing = await readSettings(status.settingsPath);
  const managedFlags = buildManagedFlags(options);
  const merged = mergeManagedFlags(existing, managedFlags);
  await writeSettings(status.settingsPath, merged);
  return { ...status, managedFlags };
}

async function reset() {
  const status = await getStatus();
  if (!status.supported) throw new Error(status.reason);
  const existing = await readSettings(status.settingsPath);
  const merged = mergeManagedFlags(existing, {});
  await writeSettings(status.settingsPath, merged);
  return { ...status, managedFlags: {} };
}

module.exports = { FPS_CAPS, MANAGED_KEYS, PROFILE_FLAGS, apply, buildManagedFlags, getStatus, mergeManagedFlags, normalizeOptions, reset };
