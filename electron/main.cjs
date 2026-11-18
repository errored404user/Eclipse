const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { listGames, normalizePlaceId } = require('../shared/roblox-api.cjs');
const fastFlags = require('./fast-flags.cjs');

let mainWindow;

const officialRobloxUrls = {
  login: 'https://www.roblox.com/login',
  download: 'https://www.roblox.com/download'
};

function gamePageUrl(placeId) {
  return `https://www.roblox.com/games/${placeId}`;
}

async function openOfficialUrl(url) {
  await shell.openExternal(url);
  return { opened: true };
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

  ipcMain.handle('fastflags:status', () => fastFlags.getStatus());
  ipcMain.handle('fastflags:apply', (_event, options) => fastFlags.apply(options));
  ipcMain.handle('fastflags:reset', () => fastFlags.reset());

  ipcMain.handle('roblox:list-games', (_event, request) => listGames(request));
  ipcMain.handle('roblox:launch-place', async (_event, placeId) => {
    const validPlaceId = normalizePlaceId(placeId);
    if (!validPlaceId) throw new Error('A valid Roblox place ID is required.');
    return openOfficialUrl(`roblox://experiences/start?placeId=${validPlaceId}`);
  });
  ipcMain.handle('roblox:open-official', async (_event, action, placeId) => {
    if (action === 'game') {
      const validPlaceId = normalizePlaceId(placeId);
      if (!validPlaceId) throw new Error('A valid Roblox place ID is required.');
      return openOfficialUrl(gamePageUrl(validPlaceId));
    }
    if (!Object.hasOwn(officialRobloxUrls, action)) throw new Error('Unsupported official Roblox action.');
    return openOfficialUrl(officialRobloxUrls[action]);
  });

  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
