const fs = require('node:fs/promises');
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

const MANAGED_KEYS = Object.freeze([
  'DFFlagTextureQualityOverrideEnabled',
  'DFIntTextureQualityOverride',
  'FIntDebugForceMSAASamples',
  'DFIntTaskSchedulerTargetFps',
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
    renderingMode: RENDERING_MODES.includes(requestedMode) ? requestedMode : 'automatic'
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
  if (normalized.fpsCap) flags.DFIntTaskSchedulerTargetFps = String(normalized.fpsCap);
  if (normalized.preserveDisplayScaling) flags.DFFlagDisableDPIScale = 'True';
  if (normalized.meshDetailEnabled) Object.assign(flags, buildMeshDetailFlags(normalized.meshDetail));
  if (normalized.frmQualityEnabled) flags.DFIntDebugFRMQualityLevelOverride = String(normalized.frmQuality);
  Object.assign(flags, buildRenderingModeFlags(normalized.renderingMode));
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
  const managedFlags = Object.fromEntries(MANAGED_KEYS.filter((key) => typeof source[key] === 'string').map((key) => [key, source[key]]));
  if (!Object.keys(managedFlags).length) return {};
  const targetPath = path.join(targetDirectory, 'ClientSettings', 'ClientAppSettings.json');
  const target = await readSettings(targetPath);
  await writeSettings(targetPath, mergeManagedFlags(target, managedFlags));
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

module.exports = { FPS_CAPS, FRM_QUALITY_RANGE, MANAGED_KEYS, MESH_DETAIL_RANGE, MSAA_LEVELS, PROFILE_FLAGS, PROFILE_MSAA, RENDERING_MODES, UNCAPPED_FPS_TARGET, apply, buildManagedFlags, buildMeshDetailFlags, buildRenderingModeFlags, getStatus, mergeManagedFlags, migrateManagedFlags, normalizeOptions, reset };
