const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { listGames, normalizePlaceId } = require('../shared/roblox-api.cjs');
const fastFlags = require('./fast-flags.cjs');
const { createDiscordPresence } = require('./discord-presence.cjs');
const { createCommunityApi } = require('./community-api.cjs');
const { createRobloxBootstrapper } = require('./roblox-bootstrapper.cjs');
const { createPlayerLaunchWindow, launchStates, sendLaunchState } = require('./launch-window.cjs');

const appIconPath = path.join(__dirname, '..', 'app', 'assets', 'eclipse-icon.png');

let mainWindow;
let activeLaunchWindow;
let activeLaunchTimer;
const communityApi = createCommunityApi(process.env);
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
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
}

app.setAppUserModelId('app.eclipse.client');
app.whenReady().then(() => {
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
    enabled: options.enabled === true
  }));

  ipcMain.handle('community:status', () => communityApi.status());
  ipcMain.handle('community:register', (_event, details) => communityApi.register(details));
  ipcMain.handle('community:login', (_event, details) => communityApi.login(details));
  ipcMain.handle('community:logout', () => communityApi.logout());
  ipcMain.handle('community:me', () => communityApi.me());
  ipcMain.handle('community:resend-verification', () => communityApi.resendVerification());
  ipcMain.handle('community:friends', () => communityApi.friends());
  ipcMain.handle('community:lookup', (_event, username) => communityApi.lookup(username));
  ipcMain.handle('community:request-friend', (_event, username) => communityApi.requestFriend(username));
  ipcMain.handle('community:respond-friend-request', (_event, id, action) => communityApi.respondFriendRequest(id, action));
  ipcMain.handle('community:messages', (_event, friend) => communityApi.messages(friend));
  ipcMain.handle('community:send-message', (_event, friend, body) => communityApi.sendMessage(friend, body));
  ipcMain.handle('community:send-place-invite', (_event, friend, placeId) => communityApi.sendPlaceInvite(friend, placeId));
  ipcMain.handle('community:block', (_event, username) => communityApi.block(username));
  ipcMain.handle('community:report', (_event, details) => communityApi.report(details));

  ipcMain.handle('roblox-bootstrapper:status', () => robloxBootstrapper.status());
  ipcMain.handle('roblox-bootstrapper:update', () => robloxBootstrapper.installOrUpdate());

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

  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => discordPresence.close());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
