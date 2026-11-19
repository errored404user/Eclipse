const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { listGames, normalizePlaceId } = require('../shared/roblox-api.cjs');
const fastFlags = require('./fast-flags.cjs');
const { createDiscordPresence } = require('./discord-presence.cjs');
const { createRobloxBootstrapper } = require('./roblox-bootstrapper.cjs');
const { createPlayerLaunchWindow, launchStates, sendLaunchState } = require('./launch-window.cjs');
const { navigationPageFromArguments, placeIdFromArguments, startupStatus, taskbarJumpList } = require('./system-integration.cjs');
const { readRecentPlaceIds, writeRecentPlaceIds } = require('./taskbar-recents.cjs');
const { createPlayerMods } = require('./player-mods.cjs');
const { isUsableWindow, revealWindow } = require('./window-visibility.cjs');

const appIconPath = path.join(__dirname, '..', 'app', 'assets', 'eclipse-icon.png');
const CREATOR_SELECTION_TTL_MS = 30 * 60 * 1000;
const creatorAssetSelections = new Map();

function creatorAssetKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return ['texture', 'sound'].includes(kind) ? kind : '';
}

function clearExpiredCreatorSelections() {
  const now = Date.now();
  for (const [token, selection] of creatorAssetSelections) {
    if (!selection || selection.expiresAt <= now) creatorAssetSelections.delete(token);
  }
}

function creatorAssetFilter(kind) {
  return kind === 'texture'
    ? [{ name: 'Texture assets', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    : [{ name: 'Sound assets', extensions: ['ogg', 'mp3', 'wav'] }];
}

let mainWindow;
let activeLaunchWindow;
let activeLaunchTimer;
let recentLaunchPlaceIds = [];
let pendingNavigationPage = navigationPageFromArguments(process.argv);
let pendingLaunchPlaceId = placeIdFromArguments(process.argv);
let playerMods;
const robloxBootstrapper = createRobloxBootstrapper({
  beforeInstall: async (context) => playerMods?.prepareForPlayerUpdate(context)
});
const discordPresence = createDiscordPresence({ applicationId: process.env.ECLIPSE_DISCORD_CLIENT_ID });
discordPresence.on('status', (status) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('discord:status', status);
});
robloxBootstrapper.on('progress', (progress) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('roblox-bootstrapper:progress', progress);
  if (activeLaunchWindow && launchStates[progress.phase]) sendLaunchState(activeLaunchWindow, progress.phase);
});

function gamePageUrl(placeId) {
  return `https://www.roblox.com/games/${placeId}`;
}

async function openOfficialUrl(url) {
  await shell.openExternal(url);
  return { opened: true };
}

function revealMainWindow(window = mainWindow) {
  return revealWindow(window);
}

function clearLaunchWindowTimer() {
  if (activeLaunchTimer) clearTimeout(activeLaunchTimer);
  activeLaunchTimer = undefined;
}

function closeLaunchWindow(launchWindow = activeLaunchWindow) {
  clearLaunchWindowTimer();
  if (launchWindow && !launchWindow.isDestroyed()) launchWindow.close();
}

function scheduleLaunchWindowClose(launchWindow, delay) {
  clearLaunchWindowTimer();
  activeLaunchTimer = setTimeout(() => closeLaunchWindow(launchWindow), delay);
}

function showPlayerLaunchWindow() {
  closeLaunchWindow();
  const launch = createPlayerLaunchWindow(BrowserWindow, mainWindow);
  activeLaunchWindow = launch.window;
  launch.window.on('closed', () => {
    if (activeLaunchWindow === launch.window) {
      clearLaunchWindowTimer();
      activeLaunchWindow = undefined;
    }
  });
  return launch;
}

async function launchRobloxPlayer(placeId) {
  const launch = showPlayerLaunchWindow();
  await launch.ready;
  sendLaunchState(launch.window, 'starting');
  try {
    await robloxBootstrapper.ensureReady();
    sendLaunchState(launch.window, 'starting');
    const result = await openOfficialUrl(`roblox://experiences/start?placeId=${placeId}`);
    rememberRecentLaunch(placeId);
    sendLaunchState(launch.window, 'connecting');
    setTimeout(() => {
      if (activeLaunchWindow === launch.window) sendLaunchState(launch.window, 'complete');
    }, 850);
    scheduleLaunchWindowClose(launch.window, 3800);
    return result;
  } catch (error) {
    sendLaunchState(launch.window, 'error');
    scheduleLaunchWindowClose(launch.window, 7000);
    throw error;
  }
}

function recoverMainWindow() {
  if (isUsableWindow(mainWindow)) return revealMainWindow();
  if (!app.isReady()) return false;
  return Boolean(createMainWindow());
}

function openNavigationPage(page) {
  if (!page) return;
  pendingNavigationPage = page;
  if (!recoverMainWindow()) return;
  mainWindow.webContents.send('system:navigate', page);
}

function refreshJumpList() {
  if (process.platform !== 'win32') return;
  app.setJumpList(taskbarJumpList(process.execPath, recentLaunchPlaceIds));
}

function taskbarRecentsPath() {
  return path.join(app.getPath('userData'), 'taskbar-recent-places.json');
}

function rememberRecentLaunch(placeId) {
  const validPlaceId = normalizePlaceId(placeId);
  if (!validPlaceId) return;
  recentLaunchPlaceIds = [validPlaceId, ...recentLaunchPlaceIds.filter((item) => item !== validPlaceId)].slice(0, 6);
  refreshJumpList();
  void writeRecentPlaceIds(taskbarRecentsPath(), recentLaunchPlaceIds).catch(() => {});
}

function currentStartupStatus() {
  const supportsWindowsStartup = process.platform === 'win32' && app.isPackaged;
  return startupStatus({
    platform: process.platform,
    isPackaged: app.isPackaged,
    loginItemSettings: supportsWindowsStartup ? app.getLoginItemSettings() : {}
  });
}

function showStartupError(window) {
  if (!isUsableWindow(window)) return;
  const errorPage = `<!doctype html><meta charset="utf-8"><title>Eclipse could not start</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08070c;color:#f6f3ff;font:15px "Segoe UI",system-ui,sans-serif}.card{max-width:460px;padding:32px;border:1px solid #3d314f;border-radius:18px;background:#17131f;box-shadow:0 18px 60px #0008}h1{margin:0 0 10px;font-size:24px}p{color:#c0b6ce;line-height:1.6}code{padding:3px 5px;border-radius:5px;background:#0d0a13;color:#d8c5ff}</style><main class="card"><h1>Eclipse could not load</h1><p>The app window was recovered, but its interface did not finish loading. Close Eclipse from Task Manager, restart it, and try again. If this continues, launch <code>npm run desktop:dev</code> from the Eclipse folder and share the terminal error.</p></main>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorPage)}`).catch(() => {});
  revealMainWindow(window);
}

function createMainWindow() {
  if (isUsableWindow(mainWindow)) {
    revealMainWindow();
    return mainWindow;
  }

  let startupErrorShown = false;
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#08070c',
    icon: appIconPath,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });
  mainWindow = window;
  let startupFallbackTimer;
  const clearStartupFallback = () => {
    if (startupFallbackTimer) clearTimeout(startupFallbackTimer);
    startupFallbackTimer = undefined;
  };
  const showStartupFailure = () => {
    if (startupErrorShown) return;
    startupErrorShown = true;
    showStartupError(window);
  };
  const sendPendingStartupRequest = () => {
    if (!isUsableWindow(window)) return;
    if (pendingNavigationPage) window.webContents.send('system:navigate', pendingNavigationPage);
    if (pendingLaunchPlaceId) {
      const placeId = pendingLaunchPlaceId;
      pendingLaunchPlaceId = 0;
      void launchRobloxPlayer(placeId);
    }
  };

  window.once('ready-to-show', () => {
    clearStartupFallback();
    revealMainWindow(window);
    sendPendingStartupRequest();
  });
  startupFallbackTimer = setTimeout(() => {
    if (isUsableWindow(window) && !window.isVisible()) revealMainWindow(window);
  }, 4_000);
  startupFallbackTimer.unref?.();

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) showStartupFailure();
  });
  window.webContents.on('render-process-gone', () => showStartupFailure());
  void window.loadFile(path.join(__dirname, '..', 'app', 'index.html')).catch(showStartupFailure);
  window.on('maximize', () => window.webContents.send('window:maximized', true));
  window.on('unmaximize', () => window.webContents.send('window:maximized', false));
  window.on('closed', () => {
    clearStartupFallback();
    if (mainWindow === window) mainWindow = undefined;
  });
  return window;
}
// Eclipse is primarily a desktop control surface; software rendering avoids driver-specific
// Chromium startup failures that otherwise leave a background-only portable process.
app.disableHardwareAcceleration();
app.setAppUserModelId('app.eclipse.client');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
if (hasSingleInstanceLock) {
app.on('second-instance', (_event, commandLine) => {
  const page = navigationPageFromArguments(commandLine);
  if (page) openNavigationPage(page);
  else recoverMainWindow();
  const placeId = placeIdFromArguments(commandLine);
  if (placeId) {
    pendingLaunchPlaceId = placeId;
    if (mainWindow && !mainWindow.isDestroyed()) {
      pendingLaunchPlaceId = 0;
      void launchRobloxPlayer(placeId);
    }
  }
});

app.whenReady().then(async () => {
  playerMods = createPlayerMods({ storageRoot: path.join(app.getPath('userData'), 'PlayerMods') });
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }
    mainWindow.maximize();
    return true;
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('player-launch:dismiss', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && senderWindow === activeLaunchWindow) closeLaunchWindow(senderWindow);
  });

  ipcMain.handle('fastflags:status', () => fastFlags.getStatus());
  ipcMain.handle('fastflags:apply', (_event, options) => fastFlags.apply(options));
  ipcMain.handle('fastflags:reset', () => fastFlags.reset());

  ipcMain.handle('mods:status', () => playerMods.status());
  ipcMain.handle('mods:import-package', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Eclipse Player Pack',
      properties: ['openFile'],
      filters: [{ name: 'Eclipse Player pack', extensions: ['eclipsepack'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ...(await playerMods.status()), canceled: true };
    return { ...(await playerMods.importPackage(result.filePaths[0])), canceled: false };
  });
  ipcMain.handle('mods:import-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Player Pack Folder',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { ...(await playerMods.status()), canceled: true };
    return { ...(await playerMods.importFolder(result.filePaths[0])), canceled: false };
  });
  ipcMain.handle('mods:pick-creator-asset', async (_event, value) => {
    const kind = creatorAssetKind(value);
    if (!kind) throw new Error('Choose whether the new asset is a texture or sound.');
    clearExpiredCreatorSelections();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Choose ${kind === 'texture' ? 'Texture or UI' : 'Sound'} Asset`,
      properties: ['openFile'],
      filters: creatorAssetFilter(kind)
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const token = randomUUID();
    creatorAssetSelections.set(token, { path: result.filePaths[0], kind, expiresAt: Date.now() + CREATOR_SELECTION_TTL_MS });
    return { canceled: false, token, kind, fileName: path.basename(result.filePaths[0]).slice(0, 140) };
  });
  ipcMain.handle('mods:create-package', async (_event, request = {}) => {
    clearExpiredCreatorSelections();
    const requestedAssets = Array.isArray(request.assets) ? request.assets : [];
    const assetFiles = new Map();
    for (const asset of requestedAssets) {
      const source = typeof asset?.source === 'string' ? asset.source : '';
      const token = typeof asset?.token === 'string' ? asset.token : '';
      const selection = creatorAssetSelections.get(token);
      if (!source || !selection) throw new Error('Choose each creator asset again before building the package.');
      assetFiles.set(source, selection.path);
    }
    const suggestedId = String(request?.manifest?.id || 'eclipse-player-pack').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'eclipse-player-pack';
    const destination = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Eclipse Player Pack',
      defaultPath: path.join(app.getPath('downloads'), `${suggestedId}.eclipsepack`),
      filters: [{ name: 'Eclipse Player pack', extensions: ['eclipsepack'] }]
    });
    if (destination.canceled || !destination.filePath) return { ...(await playerMods.status()), canceled: true };
    const createdPackage = await playerMods.createPackage({ manifest: request.manifest, assetFiles, destination: destination.filePath });
    const status = await playerMods.importPackage(destination.filePath);
    for (const asset of requestedAssets) creatorAssetSelections.delete(asset?.token);
    return { ...status, canceled: false, createdPackage };
  });
  ipcMain.handle('mods:set-enabled', (_event, id, enabled) => playerMods.setEnabled(String(id || ''), enabled === true));
  ipcMain.handle('mods:restore', () => playerMods.restoreActive());
  ipcMain.handle('mods:remove', (_event, id) => playerMods.removePack(String(id || '')));

  ipcMain.handle('discord:status', () => discordPresence.status());
  ipcMain.handle('discord:configure', (_event, options = {}) => discordPresence.configure({
    applicationId: String(options.applicationId || ''),
    enabled: options.enabled === true,
    imageAssetKey: String(options.imageAssetKey || ''),
    activityDisplay: String(options.activityDisplay || '')
  }));

  ipcMain.handle('roblox-bootstrapper:status', () => robloxBootstrapper.status());
  ipcMain.handle('roblox-bootstrapper:update', () => robloxBootstrapper.installOrUpdate());
  ipcMain.handle('roblox-bootstrapper:repair', () => robloxBootstrapper.repair());

  ipcMain.handle('system:startup-status', () => currentStartupStatus());
  ipcMain.handle('system:set-startup', (_event, enabled) => {
    const current = currentStartupStatus();
    if (!current.supported) return current;
    app.setLoginItemSettings({ openAtLogin: enabled === true, openAsHidden: false });
    return currentStartupStatus();
  });

  ipcMain.handle('roblox:list-games', (_event, request) => listGames(request));
  ipcMain.handle('roblox:launch-place', async (_event, placeId) => {
    const validPlaceId = normalizePlaceId(placeId);
    if (!validPlaceId) throw new Error('A valid Roblox place ID is required.');
    return launchRobloxPlayer(validPlaceId);
  });
  ipcMain.handle('roblox:open-official', async (_event, action, placeId) => {
    if (action === 'game') {
      const validPlaceId = normalizePlaceId(placeId);
      if (!validPlaceId) throw new Error('A valid Roblox place ID is required.');
      return openOfficialUrl(gamePageUrl(validPlaceId));
    }
    throw new Error('Unsupported official Roblox action.');
  });

  recentLaunchPlaceIds = await readRecentPlaceIds(taskbarRecentsPath());
  refreshJumpList();
  createMainWindow();
  app.on('activate', () => recoverMainWindow());
});
}

app.on('before-quit', () => discordPresence.close());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
