const test = require('node:test');
const assert = require('node:assert/strict');

test('maps official Roblox explore and search payloads into launchable games', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    let body;
    if (value.includes('explore-api')) {
      body = {
        sorts: [{
          sortId: 'top-playing',
          games: [{
            universeId: 42,
            rootPlaceId: 1818,
            name: 'Official Example',
            creatorName: 'Roblox',
            playerCount: 12345,
            totalUpVotes: 90,
            totalDownVotes: 10
          }]
        }]
      };
    } else if (value.includes('search-api')) {
      body = {
        searchResults: [{
          contents: [{
            universeId: 99,
            rootPlaceId: 99,
            name: 'Search Result',
            creatorName: 'Roblox',
            playerCount: 300,
            totalUpVotes: 19,
            totalDownVotes: 1
          }]
        }],
        nextPageToken: 'next'
      };
    } else if (value.includes('thumbnails.roblox.com')) {
      body = {
        data: [
          { targetId: 42, imageUrl: 'https://tr.rbxcdn.com/official-example.png' },
          { targetId: 99, imageUrl: 'https://tr.rbxcdn.com/search-result.png' }
        ]
      };
    } else {
      throw new Error(`Unexpected official endpoint: ${value}`);
    }
    return { ok: true, status: 200, json: async () => body };
  };

  try {
    delete require.cache[require.resolve('../shared/roblox-api.cjs')];
    const { listGames } = require('../shared/roblox-api.cjs');
    const explore = await listGames();
    const search = await listGames({ query: 'example' });

    assert.deepEqual(explore.games[0], {
      universeId: 42,
      placeId: 1818,
      name: 'Official Example',
      description: '',
      creator: 'Roblox',
      playing: 12345,
      rating: 90,
      imageUrl: 'https://tr.rbxcdn.com/official-example.png'
    });
    assert.equal(search.games[0].placeId, 99);
    assert.equal(search.games[0].imageUrl, 'https://tr.rbxcdn.com/search-result.png');
    assert.equal(search.nextCursor, 'next');
  } finally {
    global.fetch = originalFetch;
  }
});

test('accepts only safe numeric Roblox place IDs', () => {
  const { normalizePlaceId } = require('../shared/roblox-api.cjs');
  assert.equal(normalizePlaceId('1818'), 1818);
  assert.equal(normalizePlaceId(' 1818 '), 1818);
  for (const value of ['0', '-1', '1e4', '1818&other=value', 'https://example.com', '9007199254740992']) {
    assert.equal(normalizePlaceId(value), null);
  }
});

test('builds and resets only the safe managed Fast Flag keys', () => {
  const { buildManagedFlags, mergeManagedFlags } = require('../electron/fast-flags.cjs');
  const flags = buildManagedFlags({ profile: 'balanced', fpsCap: 144, disableDpiScaling: true });
  assert.deepEqual(flags, {
    DFFlagTextureQualityOverrideEnabled: 'True',
    DFIntTextureQualityOverride: '2',
    FIntDebugForceMSAASamples: '2',
    DFIntTaskSchedulerTargetFps: '144',
    DFFlagDisableDPIScale: 'True'
  });
  const merged = mergeManagedFlags({ FFlagUnrelatedSetting: 'Keep', DFIntTextureQualityOverride: '99' }, flags);
  assert.equal(merged.FFlagUnrelatedSetting, 'Keep');
  assert.equal(merged.DFIntTextureQualityOverride, '2');
  const reset = mergeManagedFlags(merged, {});
  assert.deepEqual(reset, { FFlagUnrelatedSetting: 'Keep' });
});

test('defines bounded player-handoff states without pretending to read Roblox connection status', () => {
  const { launchStates } = require('../electron/launch-window.cjs');
  assert.deepEqual(Object.keys(launchStates), ['starting', 'connecting', 'complete', 'error']);
  for (const state of Object.values(launchStates)) {
    assert.equal(typeof state.label, 'string');
    assert.equal(typeof state.detail, 'string');
    assert.equal(Number.isInteger(state.progress), true);
    assert.equal(state.progress >= 0 && state.progress <= 100, true);
  }
  assert.match(launchStates.complete.detail, /Eclipse has completed the handoff/i);
});

test('builds bounded mesh, FRM, display-scaling, and rendering-mode Fast Flags', () => {
  const { buildManagedFlags, mergeManagedFlags } = require('../electron/fast-flags.cjs');
  const flags = buildManagedFlags({
    profile: 'default',
    msaa: 4,
    preserveDisplayScaling: true,
    meshDetailEnabled: true,
    meshDetail: 3,
    frmQualityEnabled: true,
    frmQuality: 2,
    renderingMode: 'd3d11'
  });
  assert.deepEqual(flags, {
    FIntDebugForceMSAASamples: '4',
    DFFlagDisableDPIScale: 'True',
    DFIntCSGLevelOfDetailSwitchingDistanceStatic: '3',
    DFIntCSGLevelOfDetailSwitchingDistance: '1000',
    DFIntCSGLevelOfDetailSwitchingDistanceL12: '750',
    DFIntCSGLevelOfDetailSwitchingDistanceL23: '500',
    DFIntCSGLevelOfDetailSwitchingDistanceL34: '250',
    DFIntDebugFRMQualityLevelOverride: '2',
    FFlagDebugGraphicsPreferD3D11: 'True'
  });
  const reset = mergeManagedFlags({ FFlagUnrelatedSetting: 'Keep', ...flags }, {});
  assert.deepEqual(reset, { FFlagUnrelatedSetting: 'Keep' });
});

test('clamps numeric Fast Flag fine-tuning and rejects unsupported renderers', () => {
  const { normalizeOptions, buildManagedFlags } = require('../electron/fast-flags.cjs');
  assert.deepEqual(normalizeOptions({
    profile: 'not-a-profile',
    msaa: 8,
    meshDetail: 99,
    frmQuality: -5,
    renderingMode: 'opengl'
  }), {
    profile: 'default',
    fpsCap: 0,
    msaa: 0,
    preserveDisplayScaling: false,
    meshDetailEnabled: false,
    meshDetail: 3,
    frmQualityEnabled: false,
    frmQuality: 1,
    renderingMode: 'automatic'
  });
  assert.deepEqual(buildManagedFlags({ renderingMode: 'vulkan' }), { FFlagDebugGraphicsPreferVulkan: 'True' });
});

test('uses a local Eclipse profile surface and exposes no Roblox login handoff', () => {
  const renderer = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app', 'app.js'), 'utf8');
  const shell = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(renderer, /eclipse\.profile\.v1/);
  assert.match(renderer, /Create your Eclipse profile/);
  assert.match(shell, /data-profile-form/);
  assert.match(shell, /data-player-action="download"/);
  assert.doesNotMatch(renderer, /roblox\.com\/login|data-account-action|accountAction/);
  assert.doesNotMatch(shell, /Sign in at Roblox|data-account-action/);
  assert.doesNotMatch(main, /roblox\.com\/login/);
});
