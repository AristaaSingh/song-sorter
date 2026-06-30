let tracks = [];
let currentIndex = 0;
let totalTracks = 0;
let playlists = [];
let userId = '';

// Playback
let spotifyDeviceId = null;
let isPlaying = false;
let sorterReady = false;

// Waveform
let wavePhase = 0;
let waveAnimId = null;


// ---- UI helpers ----
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function toast(msg, color = '#1db954') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = color;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// ---- Waveform ----
function initWaveform() {
  const canvas = document.getElementById('waveform');
  const wrap = document.getElementById('waveform-wrap');
  canvas.width = wrap.clientWidth || 260;
  canvas.height = 32;
  drawWaveframe();
}

function drawWaveframe() {
  const canvas = document.getElementById('waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const cx = H / 2;

  ctx.clearRect(0, 0, W, H);

  const barCount = 48;
  const barW = 2;
  const gap = (W - barCount * barW) / (barCount - 1);

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#1db954');
  grad.addColorStop(1, '#158a3e');
  ctx.fillStyle = grad;

  for (let i = 0; i < barCount; i++) {
    const t = i / barCount;
    let barH;
    if (isPlaying) {
      const amp =
        0.45 * Math.sin(wavePhase * 2.1 + t * Math.PI * 5) +
        0.30 * Math.sin(wavePhase * 3.7 + t * Math.PI * 9 + 1.2) +
        0.25 * Math.sin(wavePhase * 1.3 + t * Math.PI * 3 + 2.4);
      barH = Math.max(2, Math.abs(amp) * H * 0.85);
    } else {
      barH = Math.max(2, 3 + 2 * Math.sin(wavePhase + i * 0.4));
    }
    const x = i * (barW + gap);
    ctx.fillRect(x, cx - barH / 2, barW, barH);
  }

  wavePhase += isPlaying ? 0.07 : 0.008;
  waveAnimId = requestAnimationFrame(drawWaveframe);
}

// ---- Spotify modal ----
let playbackSkipped = false;

function showSpotifyModal() {
  return new Promise((resolve) => {
    show('spotify-modal-backdrop');

    document.getElementById('modal-open-btn').onclick = () => {
      hide('spotify-modal-backdrop');
      // Open Spotify app via custom URL scheme, then retry after a delay
      window.spotify.openSpotify();
      setTimeout(() => resolve('retry'), 3000);
    };

    document.getElementById('modal-skip-btn').onclick = () => {
      hide('spotify-modal-backdrop');
      playbackSkipped = true;
      resolve('skip');
    };
  });
}

// ---- Playback via Spotify desktop app ----
async function playCurrentSong() {
  if (playbackSkipped) return;
  const track = tracks[currentIndex]?.track;
  if (!track) return;

  if (!spotifyDeviceId) {
    const data = await window.spotify.getDevices();
    const devices = data.devices || [];
    const device = devices.find(d => d.is_active) || devices[0];
    if (!device) {
      const action = await showSpotifyModal();
      if (action === 'retry') await playCurrentSong();
      return;
    }
    spotifyDeviceId = device.id;
  }

  const status = await window.spotify.startPlayback({ deviceId: spotifyDeviceId, trackUri: track.uri });
  isPlaying = (status === 204 || status === 200);
}

// ---- Init ----
async function init() {
  const cfg = await window.spotify.getConfig();
  if (!cfg.clientId || !cfg.accessToken) {
    show('setup');
    if (cfg.clientId) document.getElementById('client-id-input').value = cfg.clientId;
    return;
  }

  await loadSorter();
}

// ---- Auth ----
async function startAuth() {
  const clientId = document.getElementById('client-id-input').value.trim();
  if (!clientId) { toast('Enter your Client ID first', '#e74c3c'); return; }
  await window.spotify.saveClientId(clientId);
  hide('setup');
  show('loading-screen');
  try {
    await window.spotify.authenticate(clientId);
    await loadSorter();
  } catch {
    hide('loading-screen');
    show('setup');
    toast('Auth failed — try again', '#e74c3c');
  }
}

// ---- Load ----
async function loadSorter() {
  show('loading-screen');
  hide('setup');
  hide('sorter-wrap');
  hide('done-screen');

  const [me, first, pl] = await Promise.all([
    window.spotify.getMe(),
    window.spotify.getLikedSongs({ offset: 0, limit: 50 }),
    window.spotify.getPlaylists(),
  ]);

  userId = me.id;
  totalTracks = first.total;
  tracks = first.items;
  playlists = pl.items || [];

  hide('loading-screen');

  if (totalTracks === 0) {
    document.getElementById('done-screen').textContent = 'No liked songs found.';
    show('done-screen');
    return;
  }

  currentIndex = 0;
  sorterReady = true;
  renderPlaylists();
  showSong(0);
  show('sorter-wrap');
  initWaveform();
  // Start playback — deviceId may already be set if SDK was faster
  playCurrentSong();
}

// ---- Render song ----
async function ensureTrack(index) {
  if (tracks[index]) return;
  const batch = await window.spotify.getLikedSongs({ offset: Math.floor(index / 50) * 50, limit: 50 });
  batch.items.forEach((item, i) => {
    const base = Math.floor(index / 50) * 50;
    tracks[base + i] = item;
  });
}

function showSong(index) {
  const pct = totalTracks ? Math.round((index / totalTracks) * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `${index + 1} / ${totalTracks}`;

  const item = tracks[index];
  if (!item) return;
  const track = item.track;

  document.getElementById('track-name').textContent = track.name;
  document.getElementById('artist-name').textContent = track.artists.map(a => a.name).join(', ');
  document.getElementById('album-name').textContent = track.album.name;

  const img = track.album.images[0];
  document.getElementById('album-art').src = img ? img.url : '';
}

function renderPlaylists() {
  const list = document.getElementById('playlist-list');
  list.innerHTML = '';
  playlists.forEach(pl => {
    const btn = document.createElement('button');
    btn.className = 'playlist-btn';
    btn.textContent = pl.name;
    btn.addEventListener('click', () => addToPlaylist(pl.id, pl.name));
    list.appendChild(btn);
  });
}

// ---- Actions ----
async function addToPlaylist(playlistId, playlistName) {
  const track = tracks[currentIndex]?.track;
  if (!track) return;
  await window.spotify.addToPlaylist({ playlistId, trackUri: track.uri });
  toast(`Added to ${playlistName}`);
  await nextSong();
}

async function createAndAdd() {
  const name = document.getElementById('new-playlist-input').value.trim();
  if (!name) { toast('Enter a playlist name', '#e74c3c'); return; }

  const newPl = await window.spotify.createPlaylist({ userId, name });
  playlists.unshift(newPl);
  renderPlaylists();
  document.getElementById('new-playlist-input').value = '';

  await addToPlaylist(newPl.id, newPl.name);
}

async function nextSong() {
  currentIndex++;
  if (currentIndex >= totalTracks) {
    cancelAnimationFrame(waveAnimId);
    hide('sorter-wrap');
    show('done-screen');
    return;
  }
  await ensureTrack(currentIndex);
  showSong(currentIndex);
  playCurrentSong();
}

// ---- Boot ----
document.getElementById('auth-btn').addEventListener('click', startAuth);
document.getElementById('create-add-btn').addEventListener('click', createAndAdd);
document.getElementById('skip-btn').addEventListener('click', nextSong);
document.getElementById('new-playlist-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createAndAdd();
});

init().catch(err => {
  document.body.style.display = 'flex';
  document.body.style.alignItems = 'center';
  document.body.style.justifyContent = 'center';
  document.body.innerHTML = `<pre style="color:#e74c3c;padding:24px;font-size:12px;white-space:pre-wrap">${err.stack || err}</pre>`;
});
