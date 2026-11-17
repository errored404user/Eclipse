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
const {
  FASTFLAG_ALLOWLIST_REFERENCE,
  MANAGED_FASTFLAG_KEYS,
  buildManagedFastFlagOverrides,
  createDefaultFastFlagPreferences,
  deriveFastFlagPreferences,
  validateFastFlagPreferences
} = require('./shared/fastflags');

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


class GuardedFastFlagService {
  resolvePaths() {
    if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
      return null;
    }

    const clientSettingsDirectory = path.join(process.env.LOCALAPPDATA, 'Roblox', 'ClientSettings');
    return {
      clientSettingsDirectory,
      configurationPath: path.join(clientSettingsDirectory, 'ClientAppSettings.json'),
      backupPath: path.join(clientSettingsDirectory, 'ClientAppSettings.eclipse-backup.json')
    };
  }

  async getStatus() {
    const paths = this.resolvePaths();
    if (!paths) {
      return {
        available: false,
        blocked: true,
        configExists: false,
        backupExists: false,
        hasManagedOverrides: false,
        unmanagedFlagCount: 0,
        preferences: createDefaultFastFlagPreferences(),
        issues: [],
        message: 'Guarded FastFlags are available only on Windows with local application data.'
      };
    }

    try {
      const [configuration, backupExists] = await Promise.all([
        this.readConfiguration(paths),
        this.pathExists(paths.backupPath)
      ]);
      const derived = deriveFastFlagPreferences(configuration.flags);
      const unmanagedFlagCount = Object.keys(configuration.flags)
        .filter((key) => !MANAGED_FASTFLAG_KEYS.includes(key)).length;

      return {
        available: true,
        blocked: false,
        configExists: configuration.exists,
        backupExists,
        hasManagedOverrides: derived.hasManagedOverrides,
        unmanagedFlagCount,
        preferences: derived.preferences,
        issues: derived.issues,
        message: configuration.exists
          ? 'Eclipse found ClientAppSettings.json and will preserve entries it does not manage.'
          : 'No ClientAppSettings.json exists yet. Eclipse will create one only after you apply reviewed options.'
      };
    } catch (error) {
      return {
        available: true,
        blocked: true,
        configExists: true,
        backupExists: false,
        hasManagedOverrides: false,
        unmanagedFlagCount: 0,
        preferences: createDefaultFastFlagPreferences(),
        issues: [error.message],
        message: 'Eclipse will not modify ClientAppSettings.json until the issue is resolved.'
      };
    }
  }

  async apply(preferences) {
    const paths = this.resolvePaths();
    if (!paths) {
      throw invalidRequest('Guarded FastFlags are available only on Windows.');
    }

    const validatedPreferences = validateFastFlagPreferences(preferences);
    const configuration = await this.readConfiguration(paths);
    const managedOverrides = buildManagedFastFlagOverrides(validatedPreferences);
    if (!configuration.exists && Object.keys(managedOverrides).length === 0) {
      return this.getStatus();
    }

    const nextFlags = { ...configuration.flags };
    for (const key of MANAGED_FASTFLAG_KEYS) {
      delete nextFlags[key];
    }
    Object.assign(nextFlags, managedOverrides);

    await this.writeConfiguration(paths, nextFlags, configuration.rawContents);
    return this.getStatus();
  }

  async reset() {
    const paths = this.resolvePaths();
    if (!paths) {
      throw invalidRequest('Guarded FastFlags are available only on Windows.');
    }

    const configuration = await this.readConfiguration(paths);
    if (!configuration.exists) {
      return this.getStatus();
    }

    const nextFlags = { ...configuration.flags };
    const hadManagedOverrides = MANAGED_FASTFLAG_KEYS.some((key) => Object.hasOwn(nextFlags, key));
    if (!hadManagedOverrides) {
      return this.getStatus();
    }

    for (const key of MANAGED_FASTFLAG_KEYS) {
      delete nextFlags[key];
    }
    await this.writeConfiguration(paths, nextFlags, configuration.rawContents);
    return this.getStatus();
  }

  async readConfiguration(paths) {
    try {
      const details = await fs.lstat(paths.configurationPath);
      if (details.isSymbolicLink()) {
        throw invalidRequest('ClientAppSettings.json is a symbolic link. Eclipse will not modify it.');
      }

      const rawContents = await fs.readFile(paths.configurationPath, 'utf8');
      const parsed = JSON.parse(rawContents);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw invalidRequest('ClientAppSettings.json must contain a JSON object. Eclipse will not overwrite it.');
      }

      return { exists: true, rawContents, flags: parsed };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { exists: false, rawContents: null, flags: {} };
      }
      if (error?.isExpected) {
        throw error;
      }
      throw invalidRequest('ClientAppSettings.json is not valid JSON. Eclipse will not overwrite it.');
    }
  }

  async writeConfiguration(paths, flags, previousContents) {
    await fs.mkdir(paths.clientSettingsDirectory, { recursive: true, mode: 0o700 });

    try {
      const details = await fs.lstat(paths.clientSettingsDirectory);
      if (details.isSymbolicLink()) {
        throw invalidRequest('The Roblox ClientSettings directory is a symbolic link. Eclipse will not modify it.');
      }
    } catch (error) {
      if (error?.isExpected) {
        throw error;
      }
      throw invalidRequest('Eclipse could not validate the Roblox ClientSettings directory.');
    }

    if (previousContents !== null) {
      await this.writeAtomically(paths.backupPath, previousContents);
    }
    await this.writeAtomically(paths.configurationPath, `${JSON.stringify(flags, null, 2)}\n`);
  }

  async writeAtomically(destination, contents) {
    const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, destination);
  }

  async pathExists(targetPath) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
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
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#080c17',
    title: 'Eclipse — Roblox desktop hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  });

  window.removeMenu();
  window.setMenuBarVisibility(false);
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

  const currentWindow = (event) => BrowserWindow.fromWebContents(event.sender);
  ipcMain.on('eclipse:window:minimize', (event) => currentWindow(event)?.minimize());
  ipcMain.on('eclipse:window:toggle-maximize', (event) => {
    const window = currentWindow(event);
    if (!window) return;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });
  ipcMain.on('eclipse:window:close', (event) => currentWindow(event)?.close());

  ipcMain.handle('eclipse:dashboard', guarded(async () => {
    const state = store.get();
    const [diagnostics, fastFlags] = await Promise.all([
      buildDiagnostics(state.settings),
      fastFlagService.getStatus()
    ]);
    return { state, diagnostics, fastFlags };
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

  ipcMain.handle('eclipse:fastflags:open-reference', guarded(async () => {
    await shell.openExternal(FASTFLAG_ALLOWLIST_REFERENCE);
  }));

  ipcMain.handle('eclipse:fastflags:apply', guarded(async (payload) => {
    let preferences;
    try {
      preferences = validateFastFlagPreferences(requireObject(payload, 'FastFlag preferences are required.'));
    } catch (error) {
      throw invalidRequest(error.message);
    }

    await requireInstalledRobloxClient();
    return fastFlagService.apply(preferences);
  }));

  ipcMain.handle('eclipse:fastflags:reset', guarded(async () => {
    await requireInstalledRobloxClient();
    return fastFlagService.reset();
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
const fastFlagService = new GuardedFastFlagService();

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
