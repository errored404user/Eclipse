'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_COLLECTIONS,
  MAX_FAVORITES,
  createCollection,
  createFavorite,
  createProfile,
  normalizeSettingsPatch,
  normalizeState,
  toPlaceId
} = require('../src/shared/state');
const { isOfficialClientDetected } = require('../src/shared/installation');
const {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackupEnvelope,
  summarizeBackup,
  validateBackupEnvelope
} = require('../src/shared/backup');
const {
  buildManagedFastFlagOverrides,
  deriveFastFlagPreferences,
  validateFastFlagPreferences
} = require('../src/shared/fastflags');

test('normalizes persisted state, drops malformed records, and removes duplicate favorites', () => {
  const state = normalizeState({
    settings: { reduceMotion: true, activityTracking: true, showStartupLauncher: false, launcherPrimaryAction: 'workspace', showRecentLaunches: false, interfaceEffects: 'reduced', theme: 'aurora', density: 'compact', accent: 'mint' },
    ui: { lastPage: 'library' },
    profiles: [
      { id: 'profile_12345678901234567890', name: '  Main\nSetup ', description: ' First   profile ', color: 'mint', pinned: true, createdAt: '2026-01-01' },
      { name: '   ' }
    ],
    collections: [
      { id: 'collection_12345678901234567890', name: '  Weekend   ', description: ' Local   picks ', color: 'sky', createdAt: '2026-01-01' },
      { name: '  ' }
    ],
    favorites: [
      { placeId: '1818', title: ' Classic   Crossroads ', collectionId: 'collection_12345678901234567890', pinned: true, addedAt: '2026-01-02', lastLaunchedAt: '2026-02-03' },
      { placeId: 1818, title: 'Duplicate' },
      { placeId: 'not-an-id', title: 'Bad' }
    ]
  });

  assert.equal(state.schemaVersion, 5);
  assert.equal(state.settings.reduceMotion, true);
  assert.equal(state.settings.activityTracking, true);
  assert.equal(state.settings.showStartupLauncher, false);
  assert.equal(state.settings.launcherPrimaryAction, 'workspace');
  assert.equal(state.settings.showRecentLaunches, false);
  assert.equal(state.settings.interfaceEffects, 'reduced');
  assert.equal(state.settings.theme, 'aurora');
  assert.equal(state.settings.accent, 'mint');
  assert.equal(state.settings.density, 'compact');
  assert.equal(state.ui.lastPage, 'library');
  assert.deepEqual(state.profiles[0].name, 'Main Setup');
  assert.deepEqual(state.profiles[0].description, 'First profile');
  assert.equal(state.profiles[0].pinned, true);
  assert.equal(state.collections.length, 1);
  assert.equal(state.collections[0].name, 'Weekend');
  assert.equal(state.collections[0].description, 'Local picks');
  assert.equal(state.favorites.length, 1);
  assert.equal(state.favorites[0].placeId, 1818);
  assert.equal(state.favorites[0].title, 'Classic Crossroads');
  assert.equal(state.favorites[0].collectionId, 'collection_12345678901234567890');
  assert.equal(state.favorites[0].pinned, true);
  assert.equal(state.favorites[0].lastLaunchedAt, '2026-02-03T00:00:00.000Z');
});

test('settings use safe defaults and reject malformed update patches', () => {
  const state = normalizeState({
    settings: {
      theme: 'untrusted-theme',
      highContrast: 'true',
      activityTracking: 'true',
      showStartupLauncher: 'false',
      launcherPrimaryAction: 'direct-client',
      showRecentLaunches: 'false',
      interfaceEffects: 'maximum',
      showClientWidget: 'false',
      startPage: 'unknown-page',
      librarySort: 'title'
    },
    ui: { lastPage: 'not-a-page' }
  });

  assert.equal(state.settings.theme, 'midnight');
  assert.equal(state.settings.highContrast, false);
  assert.equal(state.settings.activityTracking, false);
  assert.equal(state.settings.showStartupLauncher, true);
  assert.equal(state.settings.launcherPrimaryAction, 'official-roblox');
  assert.equal(state.settings.showRecentLaunches, true);
  assert.equal(state.settings.interfaceEffects, 'full');
  assert.equal(state.settings.showClientWidget, true);
  assert.equal(state.settings.startPage, 'overview');
  assert.equal(state.settings.librarySort, 'title');
  assert.equal(state.ui.lastPage, 'overview');
  assert.deepEqual(normalizeSettingsPatch({ highContrast: true, activityTracking: true, showStartupLauncher: false, launcherPrimaryAction: 'workspace', showRecentLaunches: false, interfaceEffects: 'reduced', showClientWidget: false, theme: 'carbon' }), { highContrast: true, activityTracking: true, showStartupLauncher: false, launcherPrimaryAction: 'workspace', showRecentLaunches: false, interfaceEffects: 'reduced', showClientWidget: false, theme: 'carbon' });
  assert.throws(() => normalizeSettingsPatch({ theme: 'untrusted-theme' }), /theme setting is invalid/);
  assert.throws(() => normalizeSettingsPatch({ highContrast: 'true' }), /highContrast setting must be enabled or disabled/);
  assert.throws(() => normalizeSettingsPatch({ activityTracking: 'true' }), /activityTracking setting must be enabled or disabled/);
  assert.throws(() => normalizeSettingsPatch({ showStartupLauncher: 'false' }), /showStartupLauncher setting must be enabled or disabled/);
  assert.throws(() => normalizeSettingsPatch({ launcherPrimaryAction: 'direct-client' }), /launcherPrimaryAction setting is invalid/);
  assert.throws(() => normalizeSettingsPatch({ showRecentLaunches: 'false' }), /showRecentLaunches setting must be enabled or disabled/);
  assert.throws(() => normalizeSettingsPatch({ interfaceEffects: 'maximum' }), /interfaceEffects setting is invalid/);
  assert.throws(() => normalizeSettingsPatch({ unknown: true }), /Unsupported setting/);
});

test('profile, collection, and favorite creators enforce required valid user inputs', () => {
  assert.throws(() => createProfile({ name: '   ' }), /Profile name is required/);
  assert.throws(() => createCollection({ name: '   ' }), /Collection name is required/);
  assert.throws(() => createFavorite({ placeId: 'anything' }), /valid numeric Roblox experience ID/);
  assert.equal(toPlaceId('0001818'), 1818);

  const profile = createProfile({ name: '  Weekend  ', description: '  Calm  setup ', color: 'sky' });
  assert.match(profile.id, /^profile_/);
  assert.equal(profile.name, 'Weekend');
  assert.equal(profile.color, 'sky');
  assert.equal(profile.pinned, false);

  const collection = createCollection({ name: '  Weekend  ', description: '  Quiet picks ', color: 'sky' });
  assert.match(collection.id, /^collection_/);
  assert.equal(collection.name, 'Weekend');
  assert.equal(collection.description, 'Quiet picks');
  assert.equal(collection.color, 'sky');

  const favorite = createFavorite({ placeId: '1818', title: '  Crossroads ', collectionId: collection.id });
  assert.equal(favorite.placeId, 1818);
  assert.equal(favorite.title, 'Crossroads');
  assert.equal(favorite.collectionId, collection.id);
  assert.equal(favorite.pinned, false);
  assert.equal(favorite.lastLaunchedAt, null);
});

test('state retains a bounded number of unique favorite entries', () => {
  const favorites = Array.from({ length: MAX_FAVORITES + 10 }, (_, index) => ({
    placeId: index + 1,
    title: `Experience ${index + 1}`
  }));
  const state = normalizeState({ favorites });

  assert.equal(state.favorites.length, MAX_FAVORITES);
  assert.equal(state.favorites[0].placeId, 1);
  assert.equal(state.favorites.at(-1).placeId, MAX_FAVORITES);
});

test('collections are bounded and dangling saved-experience assignments are removed', () => {
  const collections = Array.from({ length: MAX_COLLECTIONS + 3 }, (_, index) => ({
    id: `collection_${String(index).padStart(20, '0')}`,
    name: `Collection ${index + 1}`
  }));
  const state = normalizeState({
    collections,
    favorites: [
      { placeId: 1818, title: 'Assigned', collectionId: collections[0].id },
      { placeId: 1819, title: 'Dangling', collectionId: 'collection_99999999999999999999' }
    ]
  });

  assert.equal(state.collections.length, MAX_COLLECTIONS);
  assert.equal(state.favorites[0].collectionId, collections[0].id);
  assert.equal(state.favorites[1].collectionId, null);

  const duplicateNames = normalizeState({
    collections: [
      { id: 'collection_11111111111111111111', name: 'Weekend' },
      { id: 'collection_22222222222222222222', name: '  weekend  ' }
    ]
  });
  assert.equal(duplicateNames.collections.length, 1);
});

test('versioned Eclipse backups validate and retain only normalized local state', () => {
  const source = normalizeState({
    settings: { theme: 'carbon', showStartupLauncher: false },
    ui: { lastPage: 'installation' },
    profiles: [{ id: 'profile_12345678901234567890', name: 'Pinned local setup', pinned: true, color: 'sky' }],
    collections: [{ id: 'collection_12345678901234567890', name: 'Archive', color: 'mint' }],
    favorites: [{ placeId: 1818, title: 'Crossroads', collectionId: 'collection_12345678901234567890' }]
  });
  const envelope = createBackupEnvelope(source, '2026-11-17T00:00:00.000Z');

  assert.equal(envelope.format, BACKUP_FORMAT);
  assert.equal(envelope.version, BACKUP_VERSION);
  assert.equal(envelope.state.profiles[0].pinned, true);
  assert.deepEqual(summarizeBackup(envelope.state), {
    profileCount: 1,
    pinnedProfileCount: 1,
    collectionCount: 1,
    favoriteCount: 1,
    preferenceCount: Object.keys(source.settings).length
  });

  const restored = validateBackupEnvelope(envelope);
  assert.equal(restored.settings.theme, 'carbon');
  assert.equal(restored.settings.showStartupLauncher, false);
  assert.equal(restored.ui.lastPage, 'installation');
  assert.equal(restored.profiles[0].pinned, true);
  assert.equal(restored.collections[0].name, 'Archive');
  assert.equal(restored.favorites[0].collectionId, 'collection_12345678901234567890');
  assert.throws(() => validateBackupEnvelope({ format: 'other', version: 1, state: {} }), /not a supported Eclipse backup/);
  assert.throws(() => validateBackupEnvelope({ format: BACKUP_FORMAT, version: BACKUP_VERSION, state: { settings: {}, ui: {} } }), /missing required local state/);
});

test('only a detected official client satisfies the launch gate', () => {
  assert.equal(isOfficialClientDetected({ status: 'detected' }), true);
  assert.equal(isOfficialClientDetected({ status: 'not-detected' }), false);
  assert.equal(isOfficialClientDetected({ status: 'unsupported-platform' }), false);
  assert.equal(isOfficialClientDetected(null), false);
});

test('guarded FastFlags produce only reviewed local overrides', () => {
  assert.deepEqual(buildManagedFastFlagOverrides({
    textureQuality: 'roblox-default',
    grassMotion: 'roblox-default',
    disableDpiScaling: false,
    antiAliasing: 'roblox-default',
    renderer: 'roblox-default'
  }), {});

  const preferences = {
    textureQuality: 'medium',
    grassMotion: 'minimized',
    disableDpiScaling: true,
    antiAliasing: '2x',
    renderer: 'vulkan'
  };
  const overrides = buildManagedFastFlagOverrides(preferences);

  assert.deepEqual(overrides, {
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: '2',
    FIntGrassMovementReducedMotionFactor: '0',
    DFFlagDisableDPIScale: 'True',
    FIntDebugForceMSAASamples: '2',
    FFlagDebugGraphicsPreferVulkan: 'True'
  });
  assert.throws(() => validateFastFlagPreferences({ ...preferences, customFlag: 'True' }), /Unsupported FastFlag preference/);
  assert.throws(() => validateFastFlagPreferences({ ...preferences, renderer: 'directx12' }), /renderer FastFlag preference is invalid/);
});

test('guarded FastFlags derive reviewed values and flag renderer conflicts', () => {
  const derived = deriveFastFlagPreferences({
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: '3',
    FIntGrassMovementReducedMotionFactor: '0',
    DFFlagDisableDPIScale: 'True',
    FIntDebugForceMSAASamples: '4',
    FFlagDebugGraphicsPreferD3D11: 'True'
  });

  assert.equal(derived.hasManagedOverrides, true);
  assert.deepEqual(derived.preferences, {
    textureQuality: 'high',
    grassMotion: 'minimized',
    disableDpiScaling: true,
    antiAliasing: '4x',
    renderer: 'd3d11'
  });

  const conflicting = deriveFastFlagPreferences({
    FFlagDebugGraphicsPreferD3D11: 'True',
    FFlagDebugGraphicsPreferVulkan: 'True'
  });
  assert.equal(conflicting.preferences.renderer, 'roblox-default');
  assert.match(conflicting.issues[0], /Multiple renderer overrides/);
  assert.match(conflicting.issues[0], /will not apply a renderer choice until you restore/);
});
