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
          sortDisplayName: 'Top Playing',
          games: [{
            universeId: 42,
            rootPlaceId: 1818,
            name: 'Official Example',
            creatorName: 'Roblox',
            playerCount: 12345,
            totalUpVotes: 90,
            totalDownVotes: 10
          }]
        }, {
          sortId: 'up-and-coming',
          sortDisplayName: 'Up and Coming',
          games: [{
            universeId: 77,
            rootPlaceId: 7070,
            name: 'Official Newcomer',
            creatorName: 'Roblox',
            playerCount: 678,
            totalUpVotes: 18,
            totalDownVotes: 2
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
          { targetId: 77, imageUrl: 'https://tr.rbxcdn.com/official-newcomer.png' },
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
    assert.deepEqual(explore.collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      places: collection.games.map((game) => game.placeId)
    })), [
      { id: 'top-playing', title: 'Top Playing', places: [1818] },
      { id: 'up-and-coming', title: 'Up and Coming', places: [7070] }
    ]);
    assert.equal(explore.collections[1].games[0].imageUrl, 'https://tr.rbxcdn.com/official-newcomer.png');
    assert.equal(search.games[0].placeId, 99);
    assert.equal(search.games[0].imageUrl, 'https://tr.rbxcdn.com/search-result.png');
    assert.equal(search.nextCursor, 'next');
  } finally {
    global.fetch = originalFetch;
  }
});

test('maps official Roblox game details and public server telemetry', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    let body;
    if (value.includes('games.roblox.com/v1/games?')) {
      body = { data: [{ id: 4242, rootPlaceId: 2424, name: 'Official Detail', description: 'An official detail payload.', creator: { name: 'Roblox' }, playing: 900, visits: 1234567, favoritedCount: 4567, maxPlayers: 24, upVotes: 90, downVotes: 10, created: '2025-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z', genre: 'Adventure' }] };
    } else if (value.includes('games.roblox.com/v1/games/2424/servers/Public')) {
      body = { data: [{ id: '9c6b852e-8f41-4b0e-9b39-29e5cc201cb3', playing: 2, maxPlayers: 24, ping: 42, fps: 60 }], nextPageCursor: 'next-server-page' };
    } else {
      throw new Error(`Unexpected official endpoint: ${value}`);
    }
    return { ok: true, status: 200, json: async () => body };
  };

  try {
    delete require.cache[require.resolve('../shared/roblox-api.cjs')];
    const { getGameDetails, listGameServers } = require('../shared/roblox-api.cjs');
    const [detail, servers] = await Promise.all([getGameDetails(4242), listGameServers(2424)]);
    assert.equal(detail.name, 'Official Detail');
    assert.equal(detail.maxPlayers, 24);
    assert.deepEqual(detail.genres, ['Adventure']);
    assert.deepEqual(servers, { servers: [{ id: '9c6b852e-8f41-4b0e-9b39-29e5cc201cb3', playing: 2, maxPlayers: 24, ping: 42, fps: 60 }], nextCursor: 'next-server-page' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('surfaces multiple official Roblox collections in Discover instead of only a trending feed', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const api = fs.readFileSync(path.join(root, 'shared', 'roblox-api.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  assert.match(api, /const MAX_EXPLORE_COLLECTIONS = 6;/);
  assert.match(api, /const MAX_GAMES_PER_COLLECTION = 12;/);
  assert.match(api, /collections = collectExploreCollections\(payload\);/);
  assert.match(renderer, /data-discovery-collections/);
  assert.match(renderer, /data-action="select-discover-collection"/);
  assert.match(renderer, /Choose another Roblox collection above to see more official experiences\./);
  assert.match(styles, /\.discovery-collection-chip\.active/);
});

test('opens official game detail and server views through bounded desktop and browser bridges only', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  assert.match(renderer, /function renderGameDetails\(\)/);
  assert.match(renderer, /data-action=\"game-details\"/);
  assert.match(renderer, /Best ping/);
  assert.match(renderer, /Low players/);
  assert.match(renderer, /High players/);
  assert.match(renderer, /Most open slots/);
  assert.match(renderer, /data-action=\"join-server\"/);
  assert.match(renderer, /function joinGameServer\(placeId, gameInstanceId\)/);
  assert.match(renderer, /Roblox-reported ping/);
  assert.match(renderer, /function sortedGameServers\(\)/);
  assert.match(preload, /roblox:game-details/);
  assert.match(preload, /roblox:game-servers/);
  assert.match(preload, /roblox:launch-server/);
  assert.match(main, /ipcMain\.handle\('roblox:game-details'/);
  assert.match(main, /ipcMain\.handle\('roblox:game-servers'/);
  assert.match(main, /ipcMain\.handle\('roblox:launch-server'/);
  assert.match(main, /normalizeGameInstanceId/);
  assert.match(server, /\/api\/roblox\/game-details/);
  assert.match(server, /\/api\/roblox\/game-servers/);
  assert.match(styles, /\.game-details-page/);
  assert.match(styles, /\.server-list/);
  for (const source of [renderer, preload, main, server, styles]) assert.doesNotMatch(source, new RegExp('game' + '.?' + 'pass', 'i'));
});

test('provides a safe Windows optimization workspace without driver downloads or live Player cleanup', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  assert.match(shell, /data-page="optimization"/);
  assert.match(shell, /icon-optimization/);
  assert.match(renderer, /function renderOptimization\(\)/);
  assert.match(renderer, /Open Windows Update/);
  assert.match(renderer, /Clear Roblox cache & logs/);
  assert.match(renderer, /No placebo “boost” switches/);
  assert.match(preload, /system:optimization-status/);
  assert.match(preload, /system:clear-eclipse-cache/);
  assert.match(preload, /system:clear-roblox-cache/);
  assert.match(main, /system:open-windows-update/);
  assert.match(main, /session\.defaultSession\.clearCache/);
  assert.match(styles, /\.optimization-page/);
  assert.match(styles, /\.optimization-grid/);
});

test('uses a reduced-motion-aware renderer splash before the Eclipse workspace appears', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  assert.match(shell, /data-app-splash/);
  assert.match(shell, /Preparing your orbit/);
  assert.match(renderer, /function finishAppSplash\(\)/);
  assert.match(renderer, /minimumDuration/);
  assert.match(renderer, /eclipse-ready/);
  assert.match(styles, /\.app-splash/);
  assert.match(styles, /eclipse-splash-failsafe/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test('uses a bounded renderer performance path without changing the safe startup backend', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(renderer, /const SERVER_RENDER_BATCH_SIZE = 40;/);
  assert.match(renderer, /performanceMode: value\?\.performanceMode !== false/);
  assert.match(renderer, /function renderGameServersPanel\(\)/);
  assert.match(renderer, /data-action=\\?"game-servers-show-more\\?"/);
  assert.match(renderer, /decoding=\\?"async\\?"/);
  assert.match(renderer, /const countFormatters/);
  assert.match(styles, /\.performance-mode \.titlebar/);
  assert.match(styles, /content-visibility: auto/);
  assert.match(styles, /animation: none !important/);
  assert.match(main, /app\.commandLine\.appendSwitch\('disable-gpu'\)/);
  assert.match(main, /app\.disableHardwareAcceleration\(\)/);
});

test('keeps local discovery, library, history, backup, and update workflows bounded', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.match(shell, /data-page="history"/);
  assert.match(renderer, /function saveDiscoverCache\(\)/);
  assert.match(renderer, /local cache/);
  assert.match(renderer, /function editLibraryTags\(universeId\)/);
  assert.match(renderer, /function editLibraryNotes\(universeId\)/);
  assert.match(renderer, /function normalizeGameNotes\(value\)/);
  assert.match(renderer, /function libraryGameCard\(game\)/);
  assert.match(renderer, /data-action=\"edit-library-tags\"/);
  assert.match(renderer, /data-action=\"edit-library-notes\"/);
  assert.match(renderer, /window\.prompt\(`Local tags/);
  assert.match(renderer, /window\.prompt\(`Private note/);
  assert.match(renderer, /writeStored\(storageKeys\.library, state\.library\)/);
  assert.match(renderer, /if \(action === 'edit-library-tags'\) editLibraryTags/);
  assert.match(renderer, /if \(action === 'edit-library-notes'\) editLibraryNotes/);
  assert.match(renderer, /function pinGameInLibrary\(game\)/);
  assert.match(renderer, /data-action=\"history-pin-game\"/);
  assert.match(renderer, /function renderHistory\(\)/);
  assert.match(renderer, /eclipse-local-backup\/v1/);
  assert.match(renderer, /function importEclipseBackup\(file\)/);
  assert.match(renderer, /function clearAllLocalEclipseData\(\)/);
  assert.match(renderer, /data-action=\"clear-local-eclipse-data\"/);
  assert.match(renderer, /Object\.values\(storageKeys\)\.forEach/);
  assert.match(renderer, /Roblox Player files, Player Packs, Fast Flags, and your Roblox account are not changed/);
  assert.match(preload, /system:clear-eclipse-data/);
  assert.match(main, /system:clear-eclipse-data/);
  assert.match(main, /session\.defaultSession\.clearStorageData/);
  assert.match(styles, /\.local-data-danger/);
  assert.match(renderer, /Refresh & re-sort/);
  assert.match(renderer, /data-game-server-filter/);
  assert.match(renderer, /state\.settings\.serverSort/);
  assert.match(renderer, /function refreshUpdateStatus/);
  assert.match(renderer, /Update check unavailable/);
  assert.match(styles, /\.library-controls/);
  assert.match(styles, /\.history-list/);
  assert.match(styles, /\.server-ping-filter/);
  assert.doesNotMatch(main, /openOfficialUrl\(placeId\)/);
  assert.match(main, /system:check-for-updates/);
  assert.match(main, /void updateChecker\.check\(\)/);
  assert.match(preload, /system:open-update-page/);
  assert.match(preload, /system:update-status/);
});

test('accepts only safe numeric Roblox place IDs', () => {
  const { normalizeGameInstanceId, normalizePlaceId } = require('../shared/roblox-api.cjs');
  assert.equal(normalizePlaceId('1818'), 1818);
  assert.equal(normalizePlaceId(' 1818 '), 1818);
  for (const value of ['0', '-1', '1e4', '1818&other=value', 'https://example.com', '9007199254740992']) {
    assert.equal(normalizePlaceId(value), null);
  }
  assert.equal(normalizeGameInstanceId('9C6B852E-8F41-4B0E-9B39-29E5CC201CB3'), '9c6b852e-8f41-4b0e-9b39-29e5cc201cb3');
  assert.equal(normalizeGameInstanceId('roblox://experiences/start?placeId=1'), '');
});

test('builds and resets only the safe managed Fast Flag keys', () => {
  const { FPS_CAPS, UNCAPPED_FPS_TARGET, buildManagedFlags, mergeManagedFlags, normalizeOptions } = require('../electron/fast-flags.cjs');
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
  assert.equal(UNCAPPED_FPS_TARGET, 9999);
  assert.equal(FPS_CAPS.includes(UNCAPPED_FPS_TARGET), true);
  assert.equal(normalizeOptions({ fpsCap: UNCAPPED_FPS_TARGET }).fpsCap, UNCAPPED_FPS_TARGET);
  assert.deepEqual(buildManagedFlags({ fpsCap: UNCAPPED_FPS_TARGET }), { DFIntTaskSchedulerTargetFps: '9999' });
});

test('defines bounded player-handoff states without pretending to read Roblox connection status', () => {
  const { launchStates } = require('../electron/launch-window.cjs');
  assert.deepEqual(Object.keys(launchStates), ['checking', 'downloading', 'verifying', 'installing', 'finalizing', 'starting', 'connecting', 'complete', 'error']);
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

test('uses a local Eclipse profile and official Windows Player bootstrapper without Roblox login or protocol ownership', () => {
  const root = require('node:path').join(__dirname, '..');
  const renderer = require('node:fs').readFileSync(require('node:path').join(root, 'app', 'app.js'), 'utf8');
  const shell = require('node:fs').readFileSync(require('node:path').join(root, 'app', 'index.html'), 'utf8');
  const main = require('node:fs').readFileSync(require('node:path').join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = require('node:fs').readFileSync(require('node:path').join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.match(renderer, /eclipse\.profile\.v1/);
  assert.match(renderer, /Create your Eclipse profile/);
  assert.match(shell, /data-profile-form/);
  assert.match(renderer, /Eclipse bootstrapper/);
  assert.match(renderer, /data-action="bootstrapper-update"/);
  assert.match(main, /roblox-bootstrapper:status/);
  assert.match(preload, /eclipseBootstrapper/);
  assert.doesNotMatch(renderer, /roblox\.com\/login|data-account-action|accountAction/);
  assert.doesNotMatch(shell, /Sign in at Roblox|data-account-action/);
  assert.doesNotMatch(main, /roblox\.com\/login|setAsDefaultProtocolClient/);
});

test('uses the Eclipse corona asset in the shell and Windows desktop package', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const handoff = fs.readFileSync(path.join(root, 'electron', 'launch-window.cjs'), 'utf8');
  const png = fs.readFileSync(path.join(root, 'app', 'assets', 'eclipse-icon.png'));
  const ico = fs.readFileSync(path.join(root, 'build', 'icon.ico'));
  assert.match(fs.readFileSync(path.join(root, 'app', 'assets', 'eclipse-icon.svg'), 'utf8'), /A violet solar eclipse/);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  assert.equal(packageJson.build.win.icon, 'build/icon.ico');
  assert.match(shell, /class="eclipse-icon title-mark"/);
  assert.match(shell, /class="eclipse-icon brand-mark"/);
  assert.match(main, /icon: appIconPath/);
  assert.match(handoff, /eclipse-icon\.png/);
});

test('uses drawn title-bar controls instead of text glyphs', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  assert.match(shell, /class="window-control minimize-control"/);
  assert.match(shell, /class="window-control maximize-control"/);
  assert.match(shell, /class="window-control close-control"/);
  assert.match(shell, /class="window-control-glyph"/);
  assert.doesNotMatch(shell, /data-window-control="minimize">−|data-window-control="maximize">□|data-window-control="close">×/);
  assert.match(renderer, /button\.dataset\.maximized = String\(isMaximized\)/);
  assert.match(styles, /\.maximize-control\[data-maximized="true"\]/);
  assert.match(styles, /\.close-control \.window-control-glyph::before/);
});

test('uses smooth, reduced-motion-aware Eclipse interface animation', () => {
  const styles = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app', 'styles.css'), 'utf8');
  assert.match(styles, /\.page-shell \{ animation: eclipse-page-in 360ms/);
  assert.match(styles, /\.game-grid \.game-card \{ animation: eclipse-card-in/);
  assert.match(styles, /\.stars \{ animation: eclipse-star-drift/);
  assert.match(styles, /@keyframes eclipse-page-in/);
  assert.match(styles, /@keyframes eclipse-glow-drift/);
  assert.match(styles, /@keyframes eclipse-toast-in/);
  assert.match(styles, /\.page-header::after/);
  assert.match(styles, /@keyframes eclipse-header-signal/);
  assert.match(styles, /@keyframes eclipse-orbit-turn/);
  assert.match(styles, /@keyframes eclipse-button-sheen/);
  assert.match(styles, /@keyframes eclipse-presence-pulse/);
  assert.match(styles, /eclipse-page-arrive 520ms/);
  assert.match(styles, /eclipse-card-arrive 560ms/);
  assert.match(styles, /@keyframes eclipse-row-arrive/);
  assert.match(styles, /\.performance-mode \.page-shell > \*/);
  assert.match(styles, /@keyframes eclipse-section-efficient/);
  assert.match(styles, /\.reduce-motion \*, \.reduce-motion \*::before, \.reduce-motion \*::after/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('routes the complete managed Fast Flags panel through its dedicated sidebar page', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const toolsSlice = renderer.slice(renderer.indexOf('function renderTools()'), renderer.indexOf('function renderFastFlags()'));
  const fastFlagsSlice = renderer.slice(renderer.indexOf('function renderFastFlags()'), renderer.indexOf('function renderSettings()'));
  assert.match(shell, /data-page="fastflags"/);
  assert.match(shell, /icon-fastflags/);
  assert.match(renderer, /fastflags: 'Fast Flags'/);
  assert.match(renderer, /state\.page === 'fastflags'/);
  assert.match(renderer, /'fastflags'/);
  assert.doesNotMatch(toolsSlice, /data-fastflags-panel|fastFlagsPanel\(\)/);
  assert.match(fastFlagsSlice, /data-fastflags-panel/);
  assert.match(fastFlagsSlice, /fastFlagsPanel\(\)/);
  assert.match(fastFlagsSlice, /refreshFastFlagsStatus\(\)/);
});

test('connects Discord Rich Presence through the desktop bridge with an Eclipse icon asset', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  const discord = fs.readFileSync(path.join(root, 'electron', 'discord-presence.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(shell, /data-page="integrations"/);
  assert.match(shell, /icon-integrations/);
  assert.match(renderer, /integrations: 'eclipse\.integrations\.v1'/);
  assert.match(renderer, /function normalizeIntegrations\(value\)/);
  assert.match(renderer, /discordClientId/);
  assert.match(renderer, /function syncDiscordPresence/);
  assert.match(renderer, /data-integration="activityTracking"/);
  assert.match(renderer, /data-integration="discordRichPresence"/);
  assert.match(renderer, /data-discord-client-id/);
  assert.match(renderer, /data-discord-asset-key/);
  assert.match(renderer, /data-discord-display/);
  assert.match(renderer, /Show Eclipse activity/);
  assert.match(renderer, /Download Eclipse icon/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('eclipseDiscord'/);
  assert.match(main, /ipcMain\.handle\('discord:configure'/);
  assert.match(discord, /details: 'Open Eclipse'/);
  assert.match(discord, /large_image: imageAssetKey/);
  assert.match(discord, /cmd: 'SET_ACTIVITY'/);
  assert.match(styles, /\.integration-client-id/);
  assert.match(styles, /\.discord-presence-preview/);
});

test('provides a guarded local Player Packs workspace without a code-mod bridge', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'electron', 'player-mods.cjs'), 'utf8');
  assert.match(shell, /data-page="mods"/);
  assert.match(shell, /icon-mods/);
  assert.match(renderer, /function renderMods\(\)/);
  assert.match(renderer, /function modsTutorial\(canCreate\)/);
  assert.match(renderer, /function modsCreator\(canCreate\)/);
  assert.match(renderer, /Verified target catalog ready/);
  assert.match(renderer, /function verifiedCreatorTarget\(asset\)/);
  assert.match(renderer, /function creatorTargetsAreVerified\(\)/);
  assert.match(renderer, /refreshModsTargets/);
  assert.match(renderer, /Build & add \.eclipsepack/);
  assert.match(renderer, /Advanced Local Mode/);
  assert.match(renderer, /content\/textures/);
  assert.match(renderer, /content\/sounds/);
  assert.match(renderer, /state\.page === 'mods'/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('eclipseMods'/);
  assert.match(preload, /targets: \(\) => ipcRenderer\.invoke\('mods:targets'\)/);
  assert.match(preload, /pickCreatorAsset/);
  assert.match(preload, /createPackage/);
  assert.match(main, /ipcMain\.handle\('mods:import-package'/);
  assert.match(main, /ipcMain\.handle\('mods:targets'/);
  assert.match(main, /ipcMain\.handle\('mods:pick-creator-asset'/);
  assert.match(main, /ipcMain\.handle\('mods:create-package'/);
  assert.match(main, /ipcMain\.handle\('mods:set-enabled'/);
  assert.match(engine, /const PACK_SCHEMA = 'eclipse-player-pack\/v1'/);
  assert.match(engine, /MAX_PACKAGE_BYTES/);
  assert.match(engine, /async availableTargets\(\)/);
  assert.match(engine, /function listPlayerAssetTargets\(/);
  assert.match(engine, /async createPackage\(/);
  assert.match(engine, /function createStoredZip\(/);
  assert.match(engine, /assertPlayerClosed/);
  assert.match(engine, /prepareForPlayerUpdate/);
  assert.match(engine, /MAX_BACKUP_BYTES/);
  assert.match(styles, /\.mods-overview/);
  assert.match(styles, /\.mods-tutorial/);
  assert.match(styles, /\.mods-creator/);
  assert.match(styles, /\.mod-pack-grid/);
});

test('keeps Fast Flags visible and lets the single profile card open a local editor with a bounded image upload', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  const libraryIndex = shell.indexOf('data-page="library"');
  const fastFlagsIndex = shell.indexOf('data-page="fastflags"');
  const workspaceIndex = shell.indexOf('nav-group nav-group-bottom');
  assert.ok(libraryIndex >= 0 && fastFlagsIndex > libraryIndex && fastFlagsIndex < workspaceIndex);
  assert.match(shell, /class="account-card profile-card account-profile-button profile-identity"[^>]+data-profile-action="open"/);
  assert.match(shell, /data-profile-image-input accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(shell, /data-profile-dialog-avatar/);
  assert.match(shell, /data-action="clear-profile-image"/);
  assert.doesNotMatch(shell, /data-profile-button|data-profile-menu|profile-actions-menu|profile-menu-toggle/);
  assert.match(renderer, /function normalizeProfileImage\(value\)/);
  assert.match(renderer, /data:image\\\/\(\?:jpeg\|png\|webp\)/);
  assert.match(renderer, /function prepareProfileImage\(file\)/);
  assert.match(renderer, /file\.size > 4 \* 1024 \* 1024/);
  assert.match(renderer, /canvas\.width = 256/);
  assert.match(renderer, /function setPendingProfileImage\(file\)/);
  assert.match(renderer, /function updateProfileDialogAvatar\(\)/);
  assert.doesNotMatch(renderer, /setProfileMenuOpen|data-profile-menu|data-profile-button/);
  assert.match(styles, /\.profile-card \{ position: relative; min-height: 54px/);
  assert.match(styles, /\.profile-dialog-avatar\.has-image/);
  assert.match(styles, /\.profile-image-upload/);
});

test('keeps collections, public-server finder preferences, and first-run setup local and explicit', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  assert.match(renderer, /Uncapped \(9,999 FPS target\)/);
  assert.match(renderer, /UNCAPPED_FPS_TARGET = 9_999/);
  assert.match(renderer, /eclipse\.library-collections\.v1/);
  assert.match(renderer, /eclipse\.server-finder-presets\.v1/);
  assert.match(renderer, /eclipse\.onboarding\.v1/);
  assert.match(renderer, /function normalizeLibraryCollections\(value\)/);
  assert.match(renderer, /function createLibraryCollection\(\)/);
  assert.match(renderer, /function editGameCollections\(universeId\)/);
  assert.match(renderer, /function moveLibraryCollection\(id, direction\)/);
  assert.match(renderer, /function moveGameInCollection\(universeId, direction\)/);
  assert.match(renderer, /Manual collection order/);
  assert.match(renderer, /function saveServerFinderPreset\(\)/);
  assert.match(renderer, /function applyGameServersResult\(detail, result/);
  assert.match(renderer, /Eclipse does not keep or rejoin expired server IDs/);
  assert.match(renderer, /data-action="save-server-finder"/);
  assert.match(renderer, /function openOnboardingIfNeeded\(\)/);
  assert.match(renderer, /function restartOnboarding\(\)/);
  assert.match(renderer, /data-action="restart-onboarding"/);
  assert.match(renderer, /Roblox credentials or take over Roblox account sign-in/);
  assert.match(renderer, /libraryCollections: state\.libraryCollections/);
  assert.match(renderer, /serverFinderPresets: state\.serverFinderPresets/);
  assert.match(shell, /data-onboarding-dialog/);
  assert.match(shell, /data-onboarding-content/);
  assert.match(styles, /\.library-collection-chips/);
  assert.match(styles, /\.server-preset-status/);
  assert.match(styles, /\.onboarding-dialog/);
  assert.match(styles, /\.high-contrast/);
  assert.match(styles, /forced-colors: active/);
});
