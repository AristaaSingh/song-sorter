const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const url = require('url');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = 'user-library-read playlist-read-private playlist-modify-public playlist-modify-private';

let mainWindow;
let authServer;

// --- Config persistence ---
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

// --- PKCE helpers ---
function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// --- Spotify API ---
function spotifyRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
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
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
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

// --- Auth flow ---
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

    if (authServer) authServer.close();

    authServer = http.createServer(async (req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname !== '/callback') { res.end(); return; }

      const code = parsed.query.code;
      if (!code || parsed.query.state !== state) {
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

    authServer.listen(REDIRECT_PORT, '127.0.0.1', () => {
      shell.openExternal(authUrl.toString());
    });
  });
}

// --- IPC handlers ---
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

ipcMain.handle('create-playlist', async (_, { userId, name }) => {
  const cfg = loadConfig();
  const res = await apiCall('POST', `/v1/users/${userId}/playlists`, { name, public: false }, cfg.clientId);
  return res.body;
});

ipcMain.handle('add-to-playlist', async (_, { playlistId, trackUri }) => {
  const cfg = loadConfig();
  const res = await apiCall('POST', `/v1/playlists/${playlistId}/tracks`, { uris: [trackUri] }, cfg.clientId);
  return res.body;
});

ipcMain.handle('get-me', async () => {
  const cfg = loadConfig();
  const res = await apiCall('GET', '/v1/me', null, cfg.clientId);
  return res.body;
});

// --- App bootstrap ---
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 700,
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
