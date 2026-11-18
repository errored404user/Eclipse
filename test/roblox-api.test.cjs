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
