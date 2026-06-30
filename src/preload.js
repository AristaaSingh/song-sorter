const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spotify', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveClientId: (id) => ipcRenderer.invoke('save-client-id', id),
  authenticate: (id) => ipcRenderer.invoke('authenticate', id),
  getLikedSongs: (opts) => ipcRenderer.invoke('get-liked-songs', opts),
  getPlaylists: () => ipcRenderer.invoke('get-playlists'),
  createPlaylist: (opts) => ipcRenderer.invoke('create-playlist', opts),
  addToPlaylist: (opts) => ipcRenderer.invoke('add-to-playlist', opts),
  getMe: () => ipcRenderer.invoke('get-me'),
});
