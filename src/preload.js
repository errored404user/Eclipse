'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eclipse', Object.freeze({
  minimizeWindow: () => ipcRenderer.send('eclipse:window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('eclipse:window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('eclipse:window:close'),
  getDashboard: () => ipcRenderer.invoke('eclipse:dashboard'),
  createProfile: (profile) => ipcRenderer.invoke('eclipse:profile:create', profile),
  removeProfile: (profileId) => ipcRenderer.invoke('eclipse:profile:remove', { profileId }),
  addFavorite: (favorite) => ipcRenderer.invoke('eclipse:favorite:add', favorite),
  removeFavorite: (placeId) => ipcRenderer.invoke('eclipse:favorite:remove', { placeId }),
  updateSettings: (settings) => ipcRenderer.invoke('eclipse:settings:update', settings),
  resetSettings: () => ipcRenderer.invoke('eclipse:settings:reset'),
  setLastPage: (page) => ipcRenderer.invoke('eclipse:ui:last-page', { page }),
  openFastFlagReference: () => ipcRenderer.invoke('eclipse:fastflags:open-reference'),
  applyFastFlags: (preferences) => ipcRenderer.invoke('eclipse:fastflags:apply', preferences),
  resetFastFlags: () => ipcRenderer.invoke('eclipse:fastflags:reset'),
  launchExperience: (placeId) => ipcRenderer.invoke('eclipse:client:launch-experience', { placeId }),
  openRobloxHome: () => ipcRenderer.invoke('eclipse:client:open-home'),
  openRobloxCatalog: () => ipcRenderer.invoke('eclipse:client:open-catalog'),
  openRobloxDownload: () => ipcRenderer.invoke('eclipse:client:open-download')
}));
