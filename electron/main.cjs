const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { listGames, normalizePlaceId } = require('../shared/roblox-api.cjs');
const fastFlags = require('./fast-flags.cjs');
const { createDiscordPresence } = require('./discord-presence.cjs');
const { createRobloxBootstrapper } = require('./roblox-bootstrapper.cjs');
const { createPlayerLaunchWindow, launchStates, sendLaunchState } = require('./launch-window.cjs');
const { navigationPageFromArguments, placeIdFromArguments, startupStatus, taskbarJumpList } = require('./system-integration.cjs');
const { readRecentPlaceIds, writeRecentPlaceIds } = require('./taskbar-recents.cjs');

const appIconPath = path.join(__dirname, '..', 'app', 'assets', 'eclipse-icon.png');

let mainWindow;
let activeLaunchWindow;
let activeLaunchTimer;
let recentLaunchPlaceIds = [];
let pendingNavigationPage = navigationPageFromArguments(process.argv);
let pendingLaunchPlaceId = placeIdFromArguments(process.argv);
const robloxBootstrapper = createRobloxBootstrapper();
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

function openNavigationPage(page) {
  if (!page) return;
  pendingNavigationPage = page;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('system:navigate', page);
  }
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

function createMainWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (pendingNavigationPage) mainWindow.webContents.send('system:navigate', pendingNavigationPage);
    if (pendingLaunchPlaceId) {
      const placeId = pendingLaunchPlaceId;
      pendingLaunchPlaceId = 0;
      void launchRobloxPlayer(placeId);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
}

app.setAppUserModelId('app.eclipse.client');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
if (hasSingleInstanceLock) {
app.on('second-instance', (_event, commandLine) => {
  openNavigationPage(navigationPageFromArguments(commandLine));
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else mainWindow?.focus();
  });
});
}

app.on('before-quit', () => discordPresence.close());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
