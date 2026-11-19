const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eclipseWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, isMaximized) => callback(Boolean(isMaximized));
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  }
});

contextBridge.exposeInMainWorld('eclipseRoblox', {
  listGames: (request = {}) => ipcRenderer.invoke('roblox:list-games', {
    query: typeof request.query === 'string' ? request.query : '',
    cursor: typeof request.cursor === 'string' ? request.cursor : ''
  }),
  gameDetails: (universeId) => ipcRenderer.invoke('roblox:game-details', universeId),
  gamePasses: (universeId) => ipcRenderer.invoke('roblox:game-passes', universeId),
  gameServers: (placeId, cursor = '') => ipcRenderer.invoke('roblox:game-servers', placeId, typeof cursor === 'string' ? cursor : ''),
  launchPlace: (placeId) => ipcRenderer.invoke('roblox:launch-place', placeId),
  openOfficial: (action, placeId) => ipcRenderer.invoke('roblox:open-official', action, placeId)
});

contextBridge.exposeInMainWorld('eclipseSystem', {
  startupStatus: () => ipcRenderer.invoke('system:startup-status'),
  setStartup: (enabled) => ipcRenderer.invoke('system:set-startup', enabled === true),
  optimizationStatus: () => ipcRenderer.invoke('system:optimization-status'),
  clearEclipseCache: () => ipcRenderer.invoke('system:clear-eclipse-cache'),
  clearRobloxCache: () => ipcRenderer.invoke('system:clear-roblox-cache'),
  openWindowsUpdate: () => ipcRenderer.invoke('system:open-windows-update'),
  onNavigate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, page) => callback(typeof page === 'string' ? page : '');
    ipcRenderer.on('system:navigate', listener);
    return () => ipcRenderer.removeListener('system:navigate', listener);
  }
});

contextBridge.exposeInMainWorld('eclipseBootstrapper', {
  status: () => ipcRenderer.invoke('roblox-bootstrapper:status'),
  update: () => ipcRenderer.invoke('roblox-bootstrapper:update'),
  repair: () => ipcRenderer.invoke('roblox-bootstrapper:repair'),
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('roblox-bootstrapper:progress', listener);
    return () => ipcRenderer.removeListener('roblox-bootstrapper:progress', listener);
  }
});

contextBridge.exposeInMainWorld('eclipseFastFlags', {
  getStatus: () => ipcRenderer.invoke('fastflags:status'),
  apply: (options = {}) => ipcRenderer.invoke('fastflags:apply', options),
  reset: () => ipcRenderer.invoke('fastflags:reset')
});

contextBridge.exposeInMainWorld('eclipseMods', {
  status: () => ipcRenderer.invoke('mods:status'),
  targets: () => ipcRenderer.invoke('mods:targets'),
  importPackage: () => ipcRenderer.invoke('mods:import-package'),
  importFolder: () => ipcRenderer.invoke('mods:import-folder'),
  pickCreatorAsset: (kind) => ipcRenderer.invoke('mods:pick-creator-asset', typeof kind === 'string' ? kind : ''),
  createPackage: (request = {}) => ipcRenderer.invoke('mods:create-package', {
    manifest: request && typeof request.manifest === 'object' ? request.manifest : {},
    assets: Array.isArray(request?.assets) ? request.assets.map((asset) => ({
      source: typeof asset?.source === 'string' ? asset.source : '',
      token: typeof asset?.token === 'string' ? asset.token : ''
    })) : []
  }),
  setEnabled: (id, enabled) => ipcRenderer.invoke('mods:set-enabled', typeof id === 'string' ? id : '', enabled === true),
  restore: () => ipcRenderer.invoke('mods:restore'),
  remove: (id) => ipcRenderer.invoke('mods:remove', typeof id === 'string' ? id : '')
});

contextBridge.exposeInMainWorld('eclipseDiscord', {
  status: () => ipcRenderer.invoke('discord:status'),
  configure: (options = {}) => ipcRenderer.invoke('discord:configure', {
    applicationId: typeof options.applicationId === 'string' ? options.applicationId : '',
    enabled: options.enabled === true,
    imageAssetKey: typeof options.imageAssetKey === 'string' ? options.imageAssetKey : '',
    activityDisplay: typeof options.activityDisplay === 'string' ? options.activityDisplay : ''
  }),
  onStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('discord:status', listener);
    return () => ipcRenderer.removeListener('discord:status', listener);
  }
});
