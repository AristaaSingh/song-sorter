let tracks = [];
let currentIndex = 0;
let totalTracks = 0;
let playlists = [];
let userId = '';
let currentSource = null; // { type: 'liked' } | { type: 'playlist', id, name }

// Playback
let spotifyDeviceId = null;
let isPlaying = false;
let pollInterval = null;

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

function progressKey() {
  return currentSource?.type === 'liked' ? 'liked' : currentSource?.id;
}

async function saveProgress() {
  const key = progressKey();
  if (key) await window.spotify.saveProgress({ key, index: currentIndex });
}

// ---- Waveform ----
function initWaveform() {
  const canvas = document.getElementById('waveform');
  const wrap = document.getElementById('waveform-wrap');
  canvas.width = wrap.clientWidth || 260;
  canvas.height = 48;
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

// ---- Playback polling ----
function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    const state = await window.spotify.getPlayerState();
    if (!state) return;
    const pct = state.item?.duration_ms
      ? (state.progress_ms / state.item.duration_ms) * 100
      : 0;
    document.getElementById('track-progress-fill').style.width = pct + '%';
    document.getElementById('track-time-current').textContent = formatTime(state.progress_ms);
    document.getElementById('track-time-total').textContent = formatTime(state.item?.duration_ms ?? 0);
    isPlaying = state.is_playing;
    document.getElementById('playpause-btn').textContent = isPlaying ? '⏸' : '▶';
  }, 1000);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

async function togglePlayPause() {
  if (isPlaying) {
    await window.spotify.pausePlayback();
    isPlaying = false;
  } else {
    const track = tracks[currentIndex]?.track;
    await window.spotify.resumePlayback({ deviceId: spotifyDeviceId, trackUri: track?.uri });
    isPlaying = true;
  }
  document.getElementById('playpause-btn').textContent = isPlaying ? '⏸' : '▶';
}

// ---- Spotify modal ----
let playbackSkipped = false;

function showSpotifyModal() {
  return new Promise((resolve) => {
    show('spotify-modal-backdrop');
    document.getElementById('modal-open-btn').onclick = () => {
      hide('spotify-modal-backdrop');
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

// ---- Playback ----
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
  if (isPlaying) {
    document.getElementById('playpause-btn').textContent = '⏸';
    startPolling();
  }
}

// ---- Source picker ----
async function showSourcePicker() {
  hide('sorter-wrap');
  hide('done-screen');
  hide('loading-screen');
  show('loading-screen');

  const [likedFirst, plRes, cfg] = await Promise.all([
    window.spotify.getLikedSongs({ offset: 0, limit: 1 }),
    window.spotify.getPlaylists(),
    window.spotify.getConfig(),
  ]);

  const progress = cfg.progress || {};
  const ownedPlaylists = (plRes.items || []).filter(p => p.owner.id === userId);

  hide('loading-screen');
  show('source-picker');

  const list = document.getElementById('source-list');
  list.innerHTML = '';

  // Liked Songs
  const likedTotal = likedFirst.total;
  const likedDone = progress['liked'] || 0;
  const likedItem = makeSourceItem({
    thumbHtml: '<div class="source-liked-thumb">♥</div>',
    name: 'Liked Songs',
    total: likedTotal,
    done: likedDone,
    onClick: () => startSorting({ type: 'liked' }, likedTotal),
  });
  list.appendChild(likedItem);

  // Owned playlists
  ownedPlaylists.forEach(pl => {
    const total = pl.tracks?.total ?? 0;
    const done = progress[pl.id] || 0;
    const imgSrc = pl.images?.[0]?.url || '';
    const item = makeSourceItem({
      thumbHtml: `<img class="source-thumb" src="${imgSrc}" alt="" />`,
      name: pl.name,
      total,
      done,
      onClick: () => startSorting({ type: 'playlist', id: pl.id, name: pl.name }, total),
    });
    list.appendChild(item);
  });
}

function makeSourceItem({ thumbHtml, name, total, done, onClick }) {
  const btn = document.createElement('button');
  btn.className = 'source-item';

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const progressHtml = done > 0
    ? `<div class="source-progress-text">${done} / ${total} sorted</div>
       <div class="source-progress-bar"><div class="source-progress-fill" style="width:${pct}%"></div></div>`
    : '';

  btn.innerHTML = `
    ${thumbHtml}
    <div class="source-info">
      <div class="source-name">${name}</div>
      <div class="source-meta">${total} songs</div>
      ${progressHtml}
    </div>
  `;
  btn.addEventListener('click', onClick);
  return btn;
}

async function startSorting(source, total) {
  currentSource = source;
  hide('source-picker');
  await loadSorter(total);
}

// ---- Init ----
async function init() {
  const cfg = await window.spotify.getConfig();
  if (!cfg.clientId || !cfg.accessToken) {
    show('setup');
    if (cfg.clientId) document.getElementById('client-id-input').value = cfg.clientId;
    return;
  }
  show('loading-screen');
  const me = await window.spotify.getMe();
  userId = me.id;
  hide('loading-screen');
  await showSourcePicker();
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
    show('loading-screen');
    const me = await window.spotify.getMe();
    userId = me.id;
    hide('loading-screen');
    await showSourcePicker();
  } catch {
    hide('loading-screen');
    show('setup');
    toast('Auth failed — try again', '#e74c3c');
  }
}

// ---- Load sorter ----
async function loadSorter(total) {
  show('loading-screen');
  hide('sorter-wrap');
  hide('done-screen');

  // Restore saved progress
  const cfg = await window.spotify.getConfig();
  const savedIndex = (cfg.progress || {})[progressKey()] || 0;
  totalTracks = total;

  // Fetch first batch at saved offset
  const batchOffset = Math.floor(savedIndex / 50) * 50;
  const [firstBatch, plRes] = await Promise.all([
    fetchTracks(batchOffset, 50),
    window.spotify.getPlaylists(),
  ]);

  tracks = new Array(totalTracks);
  firstBatch.items.forEach((item, i) => { tracks[batchOffset + i] = item; });
  playlists = (plRes.items || []).filter(p => p.owner.id === userId);

  hide('loading-screen');

  if (totalTracks === 0) {
    document.getElementById('done-msg').textContent = 'No songs found.';
    show('done-screen');
    return;
  }

  if (savedIndex >= totalTracks) {
    document.getElementById('done-msg').textContent = 'All songs in this playlist have been sorted! 🎉';
    show('done-screen');
    return;
  }

  currentIndex = savedIndex;
  renderPlaylists();
  showSong(currentIndex);
  show('sorter-wrap');
  initWaveform();
  playCurrentSong();
}

async function fetchTracks(offset, limit) {
  if (currentSource.type === 'liked') {
    return window.spotify.getLikedSongs({ offset, limit });
  } else {
    return window.spotify.getPlaylistTracks({ playlistId: currentSource.id, offset, limit });
  }
}

// ---- Render song ----
async function ensureTrack(index) {
  if (tracks[index]) return;
  const batchOffset = Math.floor(index / 50) * 50;
  const batch = await fetchTracks(batchOffset, 50);
  batch.items.forEach((item, i) => { tracks[batchOffset + i] = item; });
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

    const img = document.createElement('img');
    img.className = 'playlist-thumb';
    img.src = pl.images?.[0]?.url || '';
    img.alt = '';

    const name = document.createElement('span');
    name.textContent = pl.name;

    btn.appendChild(img);
    btn.appendChild(name);
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
  await saveProgress();

  if (currentIndex >= totalTracks) {
    cancelAnimationFrame(waveAnimId);
    stopPolling();
    hide('sorter-wrap');
    document.getElementById('done-msg').textContent = 'All done! 🎉';
    show('done-screen');
    return;
  }

  await ensureTrack(currentIndex);
  showSong(currentIndex);
  playCurrentSong();
}

// ---- Boot ----
async function previousSong() {
  if (currentIndex <= 0) return;
  currentIndex--;
  await ensureTrack(currentIndex);
  showSong(currentIndex);
  playCurrentSong();
}

document.getElementById('auth-btn').addEventListener('click', startAuth);
document.getElementById('playpause-btn').addEventListener('click', togglePlayPause);
document.getElementById('prev-btn').addEventListener('click', previousSong);
document.getElementById('next-btn').addEventListener('click', nextSong);
document.getElementById('create-add-btn').addEventListener('click', createAndAdd);
document.getElementById('sort-another-btn').addEventListener('click', () => {
  hide('done-screen');
  showSourcePicker();
});
document.getElementById('new-playlist-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createAndAdd();
});

init().catch(err => {
  document.body.style.cssText = 'display:flex;align-items:center;justify-content:center;';
  document.body.innerHTML = `<pre style="color:#e74c3c;padding:24px;font-size:12px;white-space:pre-wrap">${err.stack || err}</pre>`;
});
