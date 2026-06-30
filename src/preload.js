const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spotify', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveClientId: (id) => ipcRenderer.invoke('save-client-id', id),
  authenticate: (id) => ipcRenderer.invoke('authenticate', id),
  openSpotify: () => ipcRenderer.invoke('open-spotify'),
  saveProgress: (opts) => ipcRenderer.invoke('save-progress', opts),
  getPlaylistTracks: (opts) => ipcRenderer.invoke('get-playlist-tracks', opts),
  pausePlayback: () => ipcRenderer.invoke('pause-playback'),
  resumePlayback: (opts) => ipcRenderer.invoke('resume-playback', opts),
  getDevices: () => ipcRenderer.invoke('get-devices'),
  startPlayback: (opts) => ipcRenderer.invoke('start-playback', opts),
  getLikedSongs: (opts) => ipcRenderer.invoke('get-liked-songs', opts),
  getPlaylists: () => ipcRenderer.invoke('get-playlists'),
  createPlaylist: (opts) => ipcRenderer.invoke('create-playlist', opts),
  addToPlaylist: (opts) => ipcRenderer.invoke('add-to-playlist', opts),
  getMe: () => ipcRenderer.invoke('get-me'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
});
