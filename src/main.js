const { app, BrowserWindow, ipcMain, shell, desktopCapturer } = require('electron');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { URL: NodeURL } = require('url');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = [
  'user-library-read',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

let mainWindow;
let authServer;

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function spotifyRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function refreshAccessToken(clientId, refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await spotifyRequest({
    hostname: 'accounts.spotify.com',
    path: '/api/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, params.toString());
  if (res.status === 200) return res.body;
  throw new Error('Failed to refresh token');
}

async function apiCall(method, endpoint, body, clientId) {
  const config = loadConfig();

  async function doRequest(token) {
    return spotifyRequest({
      hostname: 'api.spotify.com',
      path: endpoint,
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }, body ? JSON.stringify(body) : undefined);
  }

  let res = await doRequest(config.accessToken);
  if (res.status === 401) {
    const refreshed = await refreshAccessToken(clientId, config.refreshToken);
    config.accessToken = refreshed.access_token;
    if (refreshed.refresh_token) config.refreshToken = refreshed.refresh_token;
    saveConfig(config);
    res = await doRequest(config.accessToken);
  }
  return res;
}

function startAuth(clientId) {
  return new Promise((resolve, reject) => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = crypto.randomBytes(16).toString('hex');

    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('show_dialog', 'true');

    if (authServer) authServer.close();

    authServer = http.createServer(async (req, res) => {
      const parsed = new NodeURL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
      if (parsed.pathname !== '/callback') { res.end(); return; }

      const code = parsed.searchParams.get('code');
      if (!code || parsed.searchParams.get('state') !== state) {
        res.writeHead(400);
        res.end('<h2>Auth failed — you can close this tab.</h2>');
        authServer.close();
        reject(new Error('Auth failed'));
        return;
      }

      res.end('<h2 style="font-family:sans-serif;padding:40px">Login successful! Switch back to Song Sorter.</h2>');
      authServer.close();

      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
      });

      const tokenRes = await spotifyRequest({
        hostname: 'accounts.spotify.com',
        path: '/api/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }, params.toString());

      if (tokenRes.status === 200) {
        const cfg = loadConfig();
        cfg.clientId = clientId;
        cfg.accessToken = tokenRes.body.access_token;
        cfg.refreshToken = tokenRes.body.refresh_token;
        saveConfig(cfg);
        resolve(tokenRes.body);
      } else {
        reject(new Error('Token exchange failed: ' + JSON.stringify(tokenRes.body)));
      }
    });

    authServer.listen(REDIRECT_PORT, '127.0.0.1', () => shell.openExternal(authUrl.toString()));
  });
}

// --- IPC ---
ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-client-id', (_, clientId) => {
  const cfg = loadConfig();
  cfg.clientId = clientId;
  saveConfig(cfg);
  return true;
});

ipcMain.handle('authenticate', async (_, clientId) => {
  await startAuth(clientId);
  return true;
});


ipcMain.handle('get-liked-songs', async (_, { offset, limit }) => {
  const cfg = loadConfig();
  const res = await apiCall('GET', `/v1/me/tracks?offset=${offset}&limit=${limit}`, null, cfg.clientId);
  return res.body;
});

ipcMain.handle('get-playlists', async () => {
  const cfg = loadConfig();
  const res = await apiCall('GET', '/v1/me/playlists?limit=50', null, cfg.clientId);
  return res.body;
});

ipcMain.handle('create-playlist', async (_, { name }) => {
  const cfg = loadConfig();
  const res = await apiCall('POST', '/v1/me/playlists', { name, public: false }, cfg.clientId);
  return res.body;
});

ipcMain.handle('set-playlist-cover', async (_, { playlistId, imageBase64 }) => {
  const cfg = loadConfig();
  const jpegData = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  return new Promise((resolve, reject) => {
    const body = jpegData;
    const req = https.request({
      hostname: 'api.spotify.com',
      path: `/v1/playlists/${playlistId}/images`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'image/jpeg',
        'Content-Length': Buffer.byteLength(body, 'base64'),
      },
    }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.write(body, 'base64');
    req.end();
  });
});

ipcMain.handle('add-to-playlist', async (_, { playlistId, trackUri }) => {
  const cfg = loadConfig();
  const res = await apiCall('POST', `/v1/playlists/${playlistId}/items`, { uris: [trackUri] }, cfg.clientId);
  return res.body;
});

ipcMain.handle('open-spotify', () => shell.openExternal('spotify:'));

ipcMain.handle('save-progress', (_, { key, index }) => {
  const cfg = loadConfig();
  if (!cfg.progress) cfg.progress = {};
  cfg.progress[key] = index;
  saveConfig(cfg);
  return true;
});

ipcMain.handle('get-playlist-tracks', async (_, { playlistId, offset, limit }) => {
  const cfg = loadConfig();
  const res = await apiCall('GET', `/v1/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}`, null, cfg.clientId);
  return res.body;
});


ipcMain.handle('pause-playback', async () => {
  const cfg = loadConfig();
  const res = await apiCall('PUT', '/v1/me/player/pause', null, cfg.clientId);
  return res.status;
});

ipcMain.handle('resume-playback', async (_, { deviceId, trackUri }) => {
  const cfg = loadConfig();
  const endpoint = deviceId ? `/v1/me/player/play?device_id=${deviceId}` : '/v1/me/player/play';
  const res = await apiCall('PUT', endpoint, { uris: [trackUri] }, cfg.clientId);
  return res.status;
});

ipcMain.handle('get-devices', async () => {
  const cfg = loadConfig();
  const res = await apiCall('GET', '/v1/me/player/devices', null, cfg.clientId);
  return res.body;
});

ipcMain.handle('start-playback', async (_, { deviceId, trackUri }) => {
  const cfg = loadConfig();
  const endpoint = deviceId
    ? `/v1/me/player/play?device_id=${deviceId}`
    : '/v1/me/player/play';
  const res = await apiCall('PUT', endpoint, { uris: [trackUri] }, cfg.clientId);
  return res.status;
});

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.map(s => ({ id: s.id, name: s.name }));
});


ipcMain.handle('get-me', async () => {
  const cfg = loadConfig();
  const res = await apiCall('GET', '/v1/me', null, cfg.clientId);
  return res.body;
});

// Allow audio autoplay without requiring a prior user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// --- Bootstrap ---
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 620,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => app.quit());
