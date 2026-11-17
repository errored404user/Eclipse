'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  MAX_FAVORITES,
  MAX_PROFILES,
  cloneState,
  createDefaultState,
  createFavorite,
  createProfile,
  isUiPage,
  normalizeSettingsPatch,
  normalizeState,
  toPlaceId
} = require('./shared/state');
const { isOfficialClientDetected } = require('./shared/installation');

const ROBLOX_HOME_URL = 'https://www.roblox.com/';
const ROBLOX_DOWNLOAD_URL = 'https://www.roblox.com/download';
const ROBLOX_CATALOG_URL = 'https://www.roblox.com/catalog';

class LocalStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = createDefaultState();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });

    try {
      const fileContents = await fs.readFile(this.filePath, 'utf8');
      this.state = normalizeState(JSON.parse(fileContents));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const backupPath = `${this.filePath}.corrupt-${Date.now()}.json`;
        try {
          await fs.rename(this.filePath, backupPath);
        } catch {
          // Preserve startup even when the corrupt file cannot be renamed.
        }
      }
      this.state = createDefaultState();
    }

    await this.persist();
    return this.get();
  }

  get() {
    return cloneState(this.state);
  }

  update(mutator) {
    const operation = this.writeQueue.then(async () => {
      const proposedState = mutator(this.get());
      this.state = normalizeState(proposedState);
      await this.persist();
      return this.get();
    });

    // Later operations must still run even when one operation fails validation or disk I/O.
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async persist() {
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await fs.rename(temporaryPath, this.filePath);
  }
}

function invalidRequest(message) {
  const error = new Error(message);
  error.isExpected = true;
  return error;
}

function requireObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest(message);
  }
  return value;
}

function requireProfileId(value) {
  if (typeof value !== 'string' || !/^profile_[a-z0-9-]{20,}$/i.test(value)) {
    throw invalidRequest('The profile identifier is invalid.');
  }
  return value;
}

async function detectRobloxInstallation() {
  if (process.platform !== 'win32') {
    return {
      status: 'unsupported-platform',
      message: 'Eclipse targets Windows. Installation detection is unavailable on this platform.'
    };
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return {
      status: 'not-detected',
      message: 'Windows local application data is unavailable, so Roblox could not be detected.'
    };
  }

  const versionsDirectory = path.join(localAppData, 'Roblox', 'Versions');
  try {
    const entries = await fs.readdir(versionsDirectory, { withFileTypes: true });
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const executablePath = path.join(versionsDirectory, entry.name, 'RobloxPlayerBeta.exe');
        try {
          const details = await fs.stat(executablePath);
          return details.isFile() ? { executablePath, modifiedAt: details.mtimeMs } : null;
        } catch {
          return null;
        }
      }));

    const latest = candidates
      .filter(Boolean)
      .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];

    if (latest) {
      return {
        status: 'detected',
        message: 'Official Roblox Player installation detected.',
        executablePath: latest.executablePath
      };
    }
  } catch {
    // A missing or unreadable conventional directory is treated as not detected.
  }

  return {
    status: 'not-detected',
    message: 'No official Roblox Player installation was detected in the standard Windows location.'
  };
}

async function buildDiagnostics(settings) {
  const rawInstallation = await detectRobloxInstallation();
  const { executablePath, ...redactedInstallation } = rawInstallation;
  const installation = settings.showInstallationPath ? rawInstallation : redactedInstallation;

  return {
    appVersion: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    ready: isOfficialClientDetected(rawInstallation),
    installation,
    security: 'Credential-free local state; no client patching, injection, or game automation.'
  };
}

async function requireInstalledRobloxClient() {
  const installation = await detectRobloxInstallation();
  if (!isOfficialClientDetected(installation)) {
    throw invalidRequest('Install the official Roblox Player and select “Check again” before launching an experience from Eclipse.');
  }
  return installation;
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b1020',
    title: 'Eclipse',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  });

  window.once('ready-to-show', () => window.show());
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return window;
}

function registerIpcHandlers(store) {
  const guarded = (handler) => async (_event, payload) => {
    try {
      return await handler(payload);
    } catch (error) {
      if (!error?.isExpected) {
        console.error('Eclipse IPC operation failed:', error);
      }
      throw new Error(error?.isExpected ? error.message : 'Eclipse could not complete that operation.');
    }
  };

  ipcMain.handle('eclipse:dashboard', guarded(async () => {
    const state = store.get();
    return {
      state,
      diagnostics: await buildDiagnostics(state.settings)
    };
  }));

  ipcMain.handle('eclipse:profile:create', guarded(async (payload) => {
    const profile = createProfile(requireObject(payload, 'Profile details are required.'));
    return store.update((state) => {
      if (state.profiles.length >= MAX_PROFILES) {
        throw invalidRequest(`Eclipse supports up to ${MAX_PROFILES} local profiles.`);
      }
      state.profiles.unshift(profile);
      return state;
    });
  }));

  ipcMain.handle('eclipse:profile:remove', guarded(async (payload) => {
    const profileId = requireProfileId(payload?.profileId);
    return store.update((state) => {
      state.profiles = state.profiles.filter((profile) => profile.id !== profileId);
      return state;
    });
  }));

  ipcMain.handle('eclipse:favorite:add', guarded(async (payload) => {
    const favorite = createFavorite(requireObject(payload, 'Experience details are required.'));
    return store.update((state) => {
      const existingIndex = state.favorites.findIndex((entry) => entry.placeId === favorite.placeId);
      if (existingIndex >= 0) {
        state.favorites[existingIndex] = { ...state.favorites[existingIndex], title: favorite.title };
      } else {
        if (state.favorites.length >= MAX_FAVORITES) {
          throw invalidRequest(`Eclipse supports up to ${MAX_FAVORITES} saved experiences.`);
        }
        state.favorites.unshift(favorite);
      }
      return state;
    });
  }));

  ipcMain.handle('eclipse:favorite:remove', guarded(async (payload) => {
    const placeId = toPlaceId(payload?.placeId);
    return store.update((state) => {
      state.favorites = state.favorites.filter((favorite) => favorite.placeId !== placeId);
      return state;
    });
  }));

  ipcMain.handle('eclipse:settings:update', guarded(async (payload) => {
    let patch;
    try {
      patch = normalizeSettingsPatch(requireObject(payload, 'Settings details are required.'));
    } catch (error) {
      throw invalidRequest(error.message);
    }

    return store.update((state) => {
      state.settings = { ...state.settings, ...patch };
      if ('startPage' in patch && !state.settings.rememberLastPage) {
        state.ui.lastPage = state.settings.startPage;
      }
      return state;
    });
  }));

  ipcMain.handle('eclipse:settings:reset', guarded(async () => {
    const defaults = createDefaultState();
    return store.update((state) => ({
      ...state,
      settings: defaults.settings,
      ui: defaults.ui
    }));
  }));

  ipcMain.handle('eclipse:ui:last-page', guarded(async (payload) => {
    const page = payload?.page;
    if (!isUiPage(page)) {
      throw invalidRequest('The requested page is invalid.');
    }

    return store.update((state) => {
      if (state.settings.rememberLastPage) {
        state.ui.lastPage = page;
      }
      return state;
    });
  }));

  ipcMain.handle('eclipse:client:launch-experience', guarded(async (payload) => {
    const placeId = toPlaceId(payload?.placeId);
    await requireInstalledRobloxClient();
    await shell.openExternal(`https://www.roblox.com/games/${placeId}`);
    return { placeId };
  }));

  ipcMain.handle('eclipse:client:open-home', guarded(async () => {
    await shell.openExternal(ROBLOX_HOME_URL);
  }));

  ipcMain.handle('eclipse:client:open-catalog', guarded(async () => {
    await shell.openExternal(ROBLOX_CATALOG_URL);
  }));

  ipcMain.handle('eclipse:client:open-download', guarded(async () => {
    await shell.openExternal(ROBLOX_DOWNLOAD_URL);
  }));
}

let stateStore;

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('gg.eclipse.robloxclient');
  }

  stateStore = new LocalStateStore(path.join(app.getPath('userData'), 'eclipse-state.json'));
  await stateStore.load();
  registerIpcHandlers(stateStore);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((error) => {
  console.error('Eclipse could not start:', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
