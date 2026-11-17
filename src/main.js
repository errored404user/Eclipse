'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const {
  MAX_COLLECTIONS,
  MAX_FAVORITES,
  MAX_PROFILES,
  cloneState,
  collectionDetails,
  createCollection,
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
  MAX_BACKUP_BYTES,
  createBackupEnvelope,
  summarizeBackup,
  validateBackupEnvelope
} = require('./shared/backup');
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

  replace(nextState) {
    return this.update(() => nextState);
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


class EclipseBackupService {
  constructor(store) {
    this.store = store;
    this.pendingImports = new Map();
  }

  async exportForWindow(window) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(window, {
      title: 'Export Eclipse backup',
      defaultPath: `eclipse-backup-${timestamp}.json`,
      filters: [{ name: 'Eclipse backup', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const envelope = createBackupEnvelope(this.store.get());
    await this.writeBackup(result.filePath, `${JSON.stringify(envelope, null, 2)}\n`);
    return { canceled: false, summary: summarizeBackup(envelope.state) };
  }

  async previewForWindow(window) {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose an Eclipse backup',
      filters: [{ name: 'Eclipse backup', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length !== 1) {
      return { canceled: true };
    }

    const contents = await this.readBackup(result.filePaths[0]);
    let importedState;
    try {
      importedState = validateBackupEnvelope(JSON.parse(contents));
    } catch (error) {
      throw invalidRequest(error?.message || 'Eclipse could not validate that backup file.');
    }

    this.pendingImports.clear();
    const token = randomUUID();
    this.pendingImports.set(token, {
      state: importedState,
      ownerWebContentsId: window?.webContents.id ?? null,
      expiresAt: Date.now() + 5 * 60 * 1000
    });
    return { canceled: false, token, summary: summarizeBackup(importedState) };
  }

  async importPending(token, window) {
    if (typeof token !== 'string') {
      throw invalidRequest('Choose and preview an Eclipse backup before importing it.');
    }

    const pending = this.pendingImports.get(token);
    this.pendingImports.delete(token);
    if (!pending || pending.expiresAt < Date.now()) {
      throw invalidRequest('The backup preview expired. Choose the backup again before importing it.');
    }
    if (pending.ownerWebContentsId !== null && pending.ownerWebContentsId !== window?.webContents.id) {
      throw invalidRequest('That backup preview belongs to a different Eclipse window. Choose the backup again.');
    }

    return this.store.replace(pending.state);
  }

  async readBackup(filePath) {
    let details;
    try {
      details = await fs.lstat(filePath);
    } catch {
      throw invalidRequest('Eclipse could not read the selected backup file.');
    }

    if (!details.isFile() || details.isSymbolicLink()) {
      throw invalidRequest('The selected backup must be a regular JSON file, not a link or directory.');
    }
    if (details.size > MAX_BACKUP_BYTES) {
      throw invalidRequest('The selected backup is larger than Eclipse’s 1 MB local-backup limit.');
    }

    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      throw invalidRequest('Eclipse could not read the selected backup file.');
    }
  }

  async writeBackup(destination, contents) {
    try {
      const details = await fs.lstat(destination);
      if (details.isSymbolicLink() || !details.isFile()) {
        throw invalidRequest('Choose a regular file name for the Eclipse backup.');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        if (error?.isExpected) throw error;
        throw invalidRequest('Eclipse could not validate the selected backup location.');
      }
    }

    const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temporaryPath, destination);
    } catch {
      try {
        await fs.unlink(temporaryPath);
      } catch {
        // A failed cleanup does not change the original error result.
      }
      throw invalidRequest('Eclipse could not save the backup at that location.');
    }
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

function requireCollectionId(value) {
  if (typeof value !== 'string' || !/^collection_[a-z0-9-]{20,}$/i.test(value)) {
    throw invalidRequest('The collection identifier is invalid.');
  }
  return value;
}

function collectionNameTaken(collections, name, excludedId = null) {
  const normalizedName = name.toLocaleLowerCase();
  return collections.some((collection) => collection.id !== excludedId && collection.name.toLocaleLowerCase() === normalizedName);
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

async function getRobloxActivity(settings) {
  if (!settings.activityTracking) {
    return {
      enabled: false,
      status: 'disabled',
      running: false,
      message: 'Activity tracking is disabled. Eclipse is not checking running processes.'
    };
  }

  if (process.platform !== 'win32') {
    return {
      enabled: true,
      status: 'unavailable',
      running: false,
      message: 'Local Roblox activity detection is available only on Windows.'
    };
  }

  try {
    const { stdout } = await execFileAsync('tasklist', [
      '/FI', 'IMAGENAME eq RobloxPlayerBeta.exe',
      '/FO', 'CSV',
      '/NH'
    ], {
      windowsHide: true,
      timeout: 2500,
      maxBuffer: 8192
    });
    const running = stdout.toLowerCase().includes('robloxplayerbeta.exe');
    return {
      enabled: true,
      status: running ? 'running' : 'idle',
      running,
      message: running
        ? 'Official Roblox Player is currently running on this device.'
        : 'Official Roblox Player is not currently running.'
    };
  } catch {
    return {
      enabled: true,
      status: 'unavailable',
      running: false,
      message: 'Eclipse could not read the local Roblox Player process state.'
    };
  }
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
  const guarded = (handler) => async (event, payload) => {
    try {
      return await handler(payload, event);
    } catch (error) {
      if (!error?.isExpected) {
        console.error('Eclipse IPC operation failed:', error);
      }
      throw new Error(error?.isExpected ? error.message : 'Eclipse could not complete that operation.');
    }
  };

  const currentWindow = (event) => BrowserWindow.fromWebContents(event.sender);
  const backups = new EclipseBackupService(store);
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
    const [diagnostics, fastFlags, activity] = await Promise.all([
      buildDiagnostics(state.settings),
      fastFlagService.getStatus(),
      getRobloxActivity(state.settings)
    ]);
    return { state, diagnostics, fastFlags, activity };
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

  ipcMain.handle('eclipse:profile:toggle-pin', guarded(async (payload) => {
    const profileId = requireProfileId(payload?.profileId);
    return store.update((state) => {
      const profile = state.profiles.find((entry) => entry.id === profileId);
      if (!profile) {
        throw invalidRequest('That local profile no longer exists.');
      }
      profile.pinned = !profile.pinned;
      return state;
    });
  }));

  ipcMain.handle('eclipse:collection:create', guarded(async (payload) => {
    let collection;
    try {
      collection = createCollection(requireObject(payload, 'Collection details are required.'));
    } catch (error) {
      throw invalidRequest(error.message);
    }

    return store.update((state) => {
      if (state.collections.length >= MAX_COLLECTIONS) {
        throw invalidRequest(`Eclipse supports up to ${MAX_COLLECTIONS} local collections.`);
      }
      if (collectionNameTaken(state.collections, collection.name)) {
        throw invalidRequest('A local collection already uses that name.');
      }
      state.collections.unshift(collection);
      return state;
    });
  }));

  ipcMain.handle('eclipse:collection:update', guarded(async (payload) => {
    const collectionId = requireCollectionId(payload?.collectionId);
    let details;
    try {
      details = collectionDetails(requireObject(payload, 'Collection details are required.'));
    } catch (error) {
      throw invalidRequest(error.message);
    }

    return store.update((state) => {
      const collection = state.collections.find((entry) => entry.id === collectionId);
      if (!collection) {
        throw invalidRequest('That local collection no longer exists.');
      }
      if (collectionNameTaken(state.collections, details.name, collectionId)) {
        throw invalidRequest('A local collection already uses that name.');
      }
      Object.assign(collection, details);
      return state;
    });
  }));

  ipcMain.handle('eclipse:collection:remove', guarded(async (payload) => {
    const collectionId = requireCollectionId(payload?.collectionId);
    return store.update((state) => {
      const collectionExists = state.collections.some((entry) => entry.id === collectionId);
      if (!collectionExists) {
        throw invalidRequest('That local collection no longer exists.');
      }
      state.collections = state.collections.filter((collection) => collection.id !== collectionId);
      state.favorites = state.favorites.map((favorite) => favorite.collectionId === collectionId
        ? { ...favorite, collectionId: null }
        : favorite);
      return state;
    });
  }));

  ipcMain.handle('eclipse:favorite:add', guarded(async (payload) => {
    const favorite = createFavorite(requireObject(payload, 'Experience details are required.'));
    return store.update((state) => {
      if (favorite.collectionId && !state.collections.some((collection) => collection.id === favorite.collectionId)) {
        throw invalidRequest('Choose an existing local collection or leave it ungrouped.');
      }
      const existingIndex = state.favorites.findIndex((entry) => entry.placeId === favorite.placeId);
      if (existingIndex >= 0) {
        state.favorites[existingIndex] = {
          ...state.favorites[existingIndex],
          title: favorite.title,
          collectionId: favorite.collectionId
        };
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

  ipcMain.handle('eclipse:backup:export', guarded(async (payload, event) => {
    return backups.exportForWindow(currentWindow(event));
  }));

  ipcMain.handle('eclipse:backup:preview-import', guarded(async (payload, event) => {
    return backups.previewForWindow(currentWindow(event));
  }));

  ipcMain.handle('eclipse:backup:import', guarded(async (payload, event) => {
    return backups.importPending(payload?.token, currentWindow(event));
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
