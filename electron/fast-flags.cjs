const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PROFILE_FLAGS = Object.freeze({
  default: Object.freeze({}),
  performance: Object.freeze({
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: '0'
  }),
  balanced: Object.freeze({
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: '2'
  }),
  quality: Object.freeze({
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: '3'
  })
});

const PROFILE_MSAA = Object.freeze({ default: 0, performance: 1, balanced: 2, quality: 4 });
const UNCAPPED_FPS_TARGET = 9_999;
const FPS_CAPS = Object.freeze([60, 120, 144, 165, 240, UNCAPPED_FPS_TARGET]);
const MSAA_LEVELS = Object.freeze([0, 1, 2, 4]);
const MESH_DETAIL_RANGE = Object.freeze({ min: 0, max: 3 });
const FRM_QUALITY_RANGE = Object.freeze({ min: 1, max: 21 });
const RENDERING_MODES = Object.freeze(['automatic', 'd3d11', 'vulkan']);

// Custom Fast Flags are user-defined entries added through the editor. They stay
// bounded and follow the Roblox FVariable naming prefixes so Eclipse never writes
// arbitrary ClientAppSettings keys. Keys Eclipse applied are tracked in a small
// Eclipse-owned state file so Reset and Player-version migration can remove or
// carry exactly the entries Eclipse wrote and nothing else.
const CUSTOM_FLAG_LIMITS = Object.freeze({ maxFlags: 50, maxKeyLength: 100, maxValueLength: 1000 });
const CUSTOM_FLAG_KEY_PATTERN = /^(?:F|DF)(?:Flag|Int|String|Log)[A-Za-z0-9_]{1,96}$/;

const MANAGED_KEYS = Object.freeze([
  'DFFlagTextureQualityOverrideEnabled',
  'DFIntTextureQualityOverride',
  'FIntDebugForceMSAASamples',
  'DFIntTaskSchedulerTargetFps',
  'FFlagTaskSchedulerLimitTargetFpsTo2402',
  'DFFlagDisableDPIScale',
  'DFIntCSGLevelOfDetailSwitchingDistanceStatic',
  'DFIntCSGLevelOfDetailSwitchingDistance',
  'DFIntCSGLevelOfDetailSwitchingDistanceL12',
  'DFIntCSGLevelOfDetailSwitchingDistanceL23',
  'DFIntCSGLevelOfDetailSwitchingDistanceL34',
  'DFIntDebugFRMQualityLevelOverride',
  'FFlagDebugGraphicsPreferD3D11',
  'FFlagDebugGraphicsPreferVulkan'
]);

function normalizeCustomFlags(value) {
  const entries = Array.isArray(value)
    ? value.map((item) => [item?.key, item?.value])
    : value && typeof value === 'object'
      ? Object.entries(value)
      : [];
  const flags = new Map();
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey ?? '').trim();
    if (!CUSTOM_FLAG_KEY_PATTERN.test(key) || key.length > CUSTOM_FLAG_LIMITS.maxKeyLength) continue;
    if (rawValue === null || rawValue === undefined || typeof rawValue === 'object' || typeof rawValue === 'function' || typeof rawValue === 'symbol') continue;
    const flagValue = String(rawValue).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CUSTOM_FLAG_LIMITS.maxValueLength);
    if (!flagValue) continue;
    flags.delete(key);
    flags.set(key, flagValue);
    if (flags.size > CUSTOM_FLAG_LIMITS.maxFlags) flags.delete(flags.keys().next().value);
  }
  return [...flags.entries()].map(([key, flagValue]) => ({ key, value: flagValue }));
}

function customFlagsObject(value) {
  return Object.fromEntries(normalizeCustomFlags(value).map((entry) => [entry.key, entry.value]));
}

function appliedStatePath() {
  if (process.env.ECLIPSE_FASTFLAG_STATE_PATH) return process.env.ECLIPSE_FASTFLAG_STATE_PATH;
  try {
    const { app } = require('electron');
    const userData = app?.getPath?.('userData');
    if (userData) return path.join(userData, 'fastflags-applied.json');
  } catch {
    // Electron is unavailable outside the desktop app (for example in tests).
  }
  return path.join(os.homedir(), '.eclipse', 'fastflags-applied.json');
}

async function readAppliedCustomKeys() {
  try {
    const parsed = JSON.parse(await fs.readFile(appliedStatePath(), 'utf8'));
    const keys = Array.isArray(parsed?.appliedKeys) ? parsed.appliedKeys : [];
    return keys.filter((key) => typeof key === 'string' && CUSTOM_FLAG_KEY_PATTERN.test(key)).slice(0, CUSTOM_FLAG_LIMITS.maxFlags);
  } catch {
    return [];
  }
}

async function writeAppliedCustomKeys(keys) {
  const statePath = appliedStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  const appliedKeys = (Array.isArray(keys) ? keys : []).filter((key) => typeof key === 'string' && CUSTOM_FLAG_KEY_PATTERN.test(key)).slice(0, CUSTOM_FLAG_LIMITS.maxFlags);
  await fs.writeFile(temporaryPath, `${JSON.stringify({ schema: 'eclipse-fastflags-applied/v1', appliedKeys }, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, statePath);
}

function clampInteger(value, range, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(range.max, Math.max(range.min, number));
}

function normalizeOptions(options = {}) {
  const profile = Object.hasOwn(PROFILE_FLAGS, options.profile) ? options.profile : 'default';
  const requestedCap = Number(options.fpsCap);
  const requestedMsaa = Number(options.msaa);
  const hasPreserveSetting = Object.hasOwn(options, 'preserveDisplayScaling');
  const requestedMode = String(options.renderingMode || 'automatic').toLowerCase();
  return {
    profile,
    fpsCap: FPS_CAPS.includes(requestedCap) ? requestedCap : 0,
    msaa: MSAA_LEVELS.includes(requestedMsaa) ? requestedMsaa : PROFILE_MSAA[profile],
    preserveDisplayScaling: hasPreserveSetting ? options.preserveDisplayScaling === true : options.disableDpiScaling === true,
    meshDetailEnabled: options.meshDetailEnabled === true,
    meshDetail: clampInteger(options.meshDetail, MESH_DETAIL_RANGE, MESH_DETAIL_RANGE.max),
    frmQualityEnabled: options.frmQualityEnabled === true,
    frmQuality: clampInteger(options.frmQuality, FRM_QUALITY_RANGE, FRM_QUALITY_RANGE.max),
    renderingMode: RENDERING_MODES.includes(requestedMode) ? requestedMode : 'automatic',
    customFlags: normalizeCustomFlags(options.customFlags)
  };
}

function buildMeshDetailFlags(detail) {
  const names = [
    'DFIntCSGLevelOfDetailSwitchingDistance',
    'DFIntCSGLevelOfDetailSwitchingDistanceL12',
    'DFIntCSGLevelOfDetailSwitchingDistanceL23',
    'DFIntCSGLevelOfDetailSwitchingDistanceL34'
  ];
  const flags = { DFIntCSGLevelOfDetailSwitchingDistanceStatic: String(detail) };
  names.forEach((name, index) => {
    flags[name] = String((Math.max(0, Math.min(3, detail - index)) + 1) * 250);
  });
  return flags;
}

function buildRenderingModeFlags(mode) {
  if (mode === 'd3d11') return { FFlagDebugGraphicsPreferD3D11: 'True' };
  if (mode === 'vulkan') return { FFlagDebugGraphicsPreferVulkan: 'True' };
  return {};
}

function buildManagedFlags(options = {}) {
  const normalized = normalizeOptions(options);
  const flags = { ...PROFILE_FLAGS[normalized.profile] };
  if (normalized.msaa) flags.FIntDebugForceMSAASamples = String(normalized.msaa);
  if (normalized.fpsCap) {
    flags.DFIntTaskSchedulerTargetFps = String(normalized.fpsCap);
    // Roblox clamps the task scheduler target to 240 FPS unless this flag is disabled.
    if (normalized.fpsCap > 240) flags.FFlagTaskSchedulerLimitTargetFpsTo2402 = 'False';
  }
  if (normalized.preserveDisplayScaling) flags.DFFlagDisableDPIScale = 'True';
  if (normalized.meshDetailEnabled) Object.assign(flags, buildMeshDetailFlags(normalized.meshDetail));
  if (normalized.frmQualityEnabled) flags.DFIntDebugFRMQualityLevelOverride = String(normalized.frmQuality);
  Object.assign(flags, buildRenderingModeFlags(normalized.renderingMode));
  for (const entry of normalized.customFlags) flags[entry.key] = entry.value;
  return flags;
}

function mergeManagedFlags(existing, managed, previousCustomKeys = []) {
  const next = { ...existing };
  for (const key of MANAGED_KEYS) delete next[key];
  for (const key of previousCustomKeys) {
    if (!Object.hasOwn(managed, key)) delete next[key];
  }
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

async function migrateManagedFlags(sourceDirectory, targetDirectory) {
  if (!sourceDirectory || !targetDirectory || sourceDirectory === targetDirectory) return {};
  const sourcePath = path.join(sourceDirectory, 'ClientSettings', 'ClientAppSettings.json');
  let source;
  try {
    source = await readSettings(sourcePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  const trackedKeys = [...MANAGED_KEYS, ...(await readAppliedCustomKeys())];
  const managedFlags = Object.fromEntries(trackedKeys.filter((key) => typeof source[key] === 'string').map((key) => [key, source[key]]));
  if (!Object.keys(managedFlags).length) return {};
  const targetPath = path.join(targetDirectory, 'ClientSettings', 'ClientAppSettings.json');
  const target = await readSettings(targetPath);
  await writeSettings(targetPath, mergeManagedFlags(target, managedFlags, await readAppliedCustomKeys()));
  return managedFlags;
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
  const appliedCustomKeys = await readAppliedCustomKeys();
  const trackedKeys = [...MANAGED_KEYS, ...appliedCustomKeys];
  const managedFlags = Object.fromEntries(trackedKeys.filter((key) => typeof settings[key] === 'string').map((key) => [key, settings[key]]));
  return { supported: true, playerDirectory, settingsPath, managedFlags, appliedCustomKeys };
}

async function apply(options) {
  const status = await getStatus();
  if (!status.supported) throw new Error(status.reason);
  const existing = await readSettings(status.settingsPath);
  const normalized = normalizeOptions(options);
  const managedFlags = buildManagedFlags(normalized);
  const merged = mergeManagedFlags(existing, managedFlags, status.appliedCustomKeys);
  await writeSettings(status.settingsPath, merged);
  const appliedCustomKeys = normalized.customFlags.map((entry) => entry.key);
  await writeAppliedCustomKeys(appliedCustomKeys);
  return { ...status, managedFlags, appliedCustomKeys };
}

async function reset() {
  const status = await getStatus();
  if (!status.supported) throw new Error(status.reason);
  const existing = await readSettings(status.settingsPath);
  const merged = mergeManagedFlags(existing, {}, status.appliedCustomKeys);
  await writeSettings(status.settingsPath, merged);
  await writeAppliedCustomKeys([]);
  return { ...status, managedFlags: {}, appliedCustomKeys: [] };
}

module.exports = { CUSTOM_FLAG_KEY_PATTERN, CUSTOM_FLAG_LIMITS, FPS_CAPS, FRM_QUALITY_RANGE, MANAGED_KEYS, MESH_DETAIL_RANGE, MSAA_LEVELS, PROFILE_FLAGS, PROFILE_MSAA, RENDERING_MODES, UNCAPPED_FPS_TARGET, apply, buildManagedFlags, buildMeshDetailFlags, buildRenderingModeFlags, customFlagsObject, getStatus, mergeManagedFlags, migrateManagedFlags, normalizeCustomFlags, normalizeOptions, readAppliedCustomKeys, reset, writeAppliedCustomKeys };
