'use strict';

const FASTFLAG_ALLOWLIST_REFERENCE = 'https://devforum.roblox.com/t/allowlist-for-local-client-configuration-via-fast-flags/3966569';
const FASTFLAG_ALLOWLIST_REVIEWED_ON = '2025-09-29';
const FASTFLAG_OPTIONS = Object.freeze({
  textureQuality: ['roblox-default', 'low', 'medium', 'high'],
  grassMotion: ['roblox-default', 'minimized'],
  disableDpiScaling: [false, true],
  antiAliasing: ['roblox-default', '1x', '2x', '4x'],
  renderer: ['roblox-default', 'd3d11', 'vulkan', 'opengl']
});
const DEFAULT_FASTFLAG_PREFERENCES = Object.freeze({
  textureQuality: 'roblox-default',
  grassMotion: 'roblox-default',
  disableDpiScaling: false,
  antiAliasing: 'roblox-default',
  renderer: 'roblox-default'
});
const MANAGED_FASTFLAG_KEYS = Object.freeze([
  'DFFlagTextureQualityOverrideEnabled',
  'DFIntTextureQualityOverride',
  'FIntGrassMovementReducedMotionFactor',
  'DFFlagDisableDPIScale',
  'FIntDebugForceMSAASamples',
  'FFlagDebugGraphicsPreferD3D11',
  'FFlagDebugGraphicsPreferVulkan',
  'FFlagDebugGraphicsPreferOpenGL'
]);

const TEXTURE_QUALITY_VALUES = Object.freeze({
  low: '1',
  medium: '2',
  high: '3'
});
const ANTI_ALIASING_VALUES = Object.freeze({
  '1x': '1',
  '2x': '2',
  '4x': '4'
});
const RENDERER_VALUES = Object.freeze({
  d3d11: 'FFlagDebugGraphicsPreferD3D11',
  vulkan: 'FFlagDebugGraphicsPreferVulkan',
  opengl: 'FFlagDebugGraphicsPreferOpenGL'
});

function createDefaultFastFlagPreferences() {
  return { ...DEFAULT_FASTFLAG_PREFERENCES };
}

function isEnabled(value) {
  return typeof value === 'string' && value.toLowerCase() === 'true';
}

function normalizeFastFlagPreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  const preferences = createDefaultFastFlagPreferences();

  for (const [key, fallback] of Object.entries(DEFAULT_FASTFLAG_PREFERENCES)) {
    const input = source[key];
    if (typeof fallback === 'boolean') {
      preferences[key] = input === true;
    } else if (typeof input === 'string' && FASTFLAG_OPTIONS[key].includes(input)) {
      preferences[key] = input;
    }
  }

  return preferences;
}

function validateFastFlagPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('FastFlag preferences are required.');
  }

  const keys = Object.keys(value);
  for (const key of keys) {
    if (!Object.hasOwn(DEFAULT_FASTFLAG_PREFERENCES, key)) {
      throw new Error(`Unsupported FastFlag preference: ${key}.`);
    }
  }

  const preferences = createDefaultFastFlagPreferences();
  for (const [key, fallback] of Object.entries(DEFAULT_FASTFLAG_PREFERENCES)) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`The ${key} FastFlag preference is required.`);
    }

    const input = value[key];
    if (typeof fallback === 'boolean') {
      if (typeof input !== 'boolean') {
        throw new Error(`The ${key} FastFlag preference must be enabled or disabled.`);
      }
      preferences[key] = input;
      continue;
    }

    if (typeof input !== 'string' || !FASTFLAG_OPTIONS[key].includes(input)) {
      throw new Error(`The ${key} FastFlag preference is invalid.`);
    }
    preferences[key] = input;
  }

  return preferences;
}

function buildManagedFastFlagOverrides(value) {
  const preferences = validateFastFlagPreferences(value);
  const overrides = {};

  if (preferences.textureQuality !== 'roblox-default') {
    overrides.DFFlagTextureQualityOverrideEnabled = 'True';
    overrides.DFIntTextureQualityOverride = TEXTURE_QUALITY_VALUES[preferences.textureQuality];
  }

  if (preferences.grassMotion === 'minimized') {
    overrides.FIntGrassMovementReducedMotionFactor = '0';
  }

  if (preferences.disableDpiScaling) {
    overrides.DFFlagDisableDPIScale = 'True';
  }

  if (preferences.antiAliasing !== 'roblox-default') {
    overrides.FIntDebugForceMSAASamples = ANTI_ALIASING_VALUES[preferences.antiAliasing];
  }

  if (preferences.renderer !== 'roblox-default') {
    overrides[RENDERER_VALUES[preferences.renderer]] = 'True';
  }

  return overrides;
}

function deriveFastFlagPreferences(value) {
  const flags = value && typeof value === 'object' ? value : {};
  const preferences = createDefaultFastFlagPreferences();
  const issues = [];

  if (isEnabled(String(flags.DFFlagTextureQualityOverrideEnabled ?? ''))) {
    const reverseTextureQuality = Object.entries(TEXTURE_QUALITY_VALUES)
      .find(([, flagValue]) => String(flags.DFIntTextureQualityOverride) === flagValue)?.[0];
    if (reverseTextureQuality) {
      preferences.textureQuality = reverseTextureQuality;
    } else {
      issues.push('The existing texture override is outside Eclipse’s reviewed options.');
    }
  }

  if (String(flags.FIntGrassMovementReducedMotionFactor) === '0') {
    preferences.grassMotion = 'minimized';
  } else if (Object.hasOwn(flags, 'FIntGrassMovementReducedMotionFactor')) {
    issues.push('The existing grass-motion override is outside Eclipse’s reviewed options.');
  }

  if (isEnabled(String(flags.DFFlagDisableDPIScale ?? ''))) {
    preferences.disableDpiScaling = true;
  }

  const reverseAntiAliasing = Object.entries(ANTI_ALIASING_VALUES)
    .find(([, flagValue]) => String(flags.FIntDebugForceMSAASamples) === flagValue)?.[0];
  if (reverseAntiAliasing) {
    preferences.antiAliasing = reverseAntiAliasing;
  } else if (Object.hasOwn(flags, 'FIntDebugForceMSAASamples')) {
    issues.push('The existing anti-aliasing override is outside Eclipse’s reviewed options.');
  }

  const activeRenderers = Object.entries(RENDERER_VALUES)
    .filter(([, flagName]) => isEnabled(String(flags[flagName] ?? '')))
    .map(([renderer]) => renderer);
  if (activeRenderers.length === 1) {
    preferences.renderer = activeRenderers[0];
  } else if (activeRenderers.length > 1) {
    issues.push('Multiple renderer overrides are active. Eclipse will not apply a renderer choice until you restore its reviewed defaults.');
  }

  const hasManagedOverrides = MANAGED_FASTFLAG_KEYS.some((key) => Object.hasOwn(flags, key));
  return { preferences, hasManagedOverrides, issues };
}

module.exports = {
  ANTI_ALIASING_VALUES,
  DEFAULT_FASTFLAG_PREFERENCES,
  FASTFLAG_ALLOWLIST_REFERENCE,
  FASTFLAG_ALLOWLIST_REVIEWED_ON,
  FASTFLAG_OPTIONS,
  MANAGED_FASTFLAG_KEYS,
  RENDERER_VALUES,
  TEXTURE_QUALITY_VALUES,
  buildManagedFastFlagOverrides,
  createDefaultFastFlagPreferences,
  deriveFastFlagPreferences,
  normalizeFastFlagPreferences,
  validateFastFlagPreferences
};
