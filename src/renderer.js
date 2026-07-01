import { extractDominantColor, applyBackground } from './background.js';
import { initWaveform, stopWaveform } from './waveform.js';

let tracks = [];
let currentIndex = 0;
let totalTracks = 0;
let playlists = [];

let userId = '';
let currentSource = null; // { type: 'liked' } | { type: 'playlist', id, name }

// Playback
let spotifyDeviceId = null;
let isPlaying = false;
let playStartTime = null;
let pausedAt = 0;
let trackDuration = 0;
let trackProgressRaf = null;

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

// ---- Track progress ----
function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '00')}`;
}

function startTrackProgress(durationMs) {
  trackDuration = durationMs;
  playStartTime = Date.now();
  pausedAt = 0;
  if (trackProgressRaf) cancelAnimationFrame(trackProgressRaf);

  document.getElementById('track-time-total').textContent = formatTime(durationMs);

  function tick() {
    if (!isPlaying) return;
    const elapsed = Math.min(Date.now() - playStartTime, trackDuration);
    const pct = (elapsed / trackDuration) * 100;
    document.getElementById('track-progress-fill').style.width = pct + '%';
    document.getElementById('track-time-current').textContent = formatTime(elapsed);
    if (elapsed < trackDuration) trackProgressRaf = requestAnimationFrame(tick);
  }
  trackProgressRaf = requestAnimationFrame(tick);
}

function stopTrackProgress() {
  if (trackProgressRaf) { cancelAnimationFrame(trackProgressRaf); trackProgressRaf = null; }
}

async function togglePlayPause() {
  if (isPlaying) {
    await window.spotify.pausePlayback();
    isPlaying = false;
    pausedAt = Date.now() - playStartTime;
    stopTrackProgress();
  } else {
    const track = tracks[currentIndex]?.track;
    await window.spotify.play({ deviceId: spotifyDeviceId, trackUri: track?.uri });
    isPlaying = true;
    playStartTime = Date.now() - pausedAt;
    startTrackProgress(trackDuration);
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

  const status = await window.spotify.play({ deviceId: spotifyDeviceId, trackUri: track.uri });
  isPlaying = (status === 204 || status === 200);
  if (isPlaying) {
    document.getElementById('playpause-btn').textContent = '⏸';
    startTrackProgress(track.duration_ms);
  }
}

// ---- Source picker ----
async function showSourcePicker() {
  hide('sorter-wrap');
  hide('done-screen');
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

  const likedTotal = likedFirst.total;
  const likedDone = progress['liked'] || 0;
  list.appendChild(makeSourceItem({
    thumbHtml: '<div class="source-liked-thumb">♥</div>',
    name: 'Liked Songs',
    total: likedTotal,
    done: likedDone,
    onClick: () => startSorting({ type: 'liked' }, likedTotal),
  }));

  ownedPlaylists.forEach(pl => {
    const total = pl.tracks?.total ?? 0;
    const done = progress[pl.id] || 0;
    const imgSrc = pl.images?.[0]?.url || '';
    list.appendChild(makeSourceItem({
      thumbHtml: `<img class="source-thumb" src="${imgSrc}" alt="" />`,
      name: pl.name,
      total,
      done,
      onClick: () => startSorting({ type: 'playlist', id: pl.id, name: pl.name }, total),
    }));
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

  const cfg = await window.spotify.getConfig();
  const savedIndex = (cfg.progress || {})[progressKey()] || 0;
  totalTracks = total;

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
  document.getElementById('progress-label').textContent = `${index + 1} / ${totalTracks}`;

  const item = tracks[index];
  if (!item) return;
  const track = item.track;

  document.getElementById('track-name').textContent = track.name;
  document.getElementById('artist-name').textContent = track.artists.map(a => a.name).join(', ');
  document.getElementById('album-name').textContent = track.album.name;

  const img = track.album.images[0];
  const imgEl = document.getElementById('album-art');
  imgEl.onload = () => applyBackground(extractDominantColor(imgEl));
  imgEl.src = img ? img.url : '';
}

function renderPlaylists() {
  const list = document.getElementById('playlist-list');
  list.innerHTML = '';
  playlists.forEach(pl => {
    const btn = document.createElement('button');
    btn.className = 'playlist-btn';
    const imgUrl = pl.images?.[0]?.url;
    let thumb;
    if (imgUrl) {
      thumb = document.createElement('img');
      thumb.className = 'playlist-thumb';
      thumb.src = imgUrl;
      thumb.alt = '';
    } else {
      thumb = document.createElement('div');
      thumb.className = 'playlist-thumb playlist-thumb-empty';
      thumb.textContent = '♪';
    }

    const name = document.createElement('span');
    name.textContent = pl.name;

    btn.appendChild(thumb);
    btn.appendChild(name);
    btn.addEventListener('click', () => addToPlaylist(pl.id, pl.name));
    list.appendChild(btn);
  });
}

function albumArtAsBase64() {
  const imgEl = document.getElementById('album-art');
  if (!imgEl.src) return null;
  const c = document.createElement('canvas');
  c.width = 300; c.height = 300;
  c.getContext('2d').drawImage(imgEl, 0, 0, 300, 300);
  return c.toDataURL('image/jpeg', 0.85);
}

// ---- Actions ----
async function addToPlaylist(playlistId, playlistName) {
  const track = tracks[currentIndex]?.track;
  if (!track) return;
  await window.spotify.addToPlaylist({ playlistId, trackUri: track.uri });
  toast(`Added to ${playlistName}`);
  await nextSong();
}

function showConfirmModal(message) {
  return new Promise((resolve) => {
    document.getElementById('confirm-modal-msg').textContent = message;
    show('confirm-modal-backdrop');
    document.getElementById('confirm-modal-yes').onclick = () => {
      hide('confirm-modal-backdrop');
      resolve(true);
    };
    document.getElementById('confirm-modal-no').onclick = () => {
      hide('confirm-modal-backdrop');
      resolve(false);
    };
  });
}

async function createAndAdd() {
  const name = document.getElementById('new-playlist-input').value.trim();
  if (!name) { toast('Enter a playlist name', '#e74c3c'); return; }

  const confirmed = await showConfirmModal(`Create "${name}" and add the current song to it?`);
  if (!confirmed) return;

  const newPl = await window.spotify.createPlaylist(name);
  if (newPl.id) {
    try {
      const base64 = albumArtAsBase64();
      if (base64) {
        await window.spotify.setPlaylistCover({ playlistId: newPl.id, imageBase64: base64 });
        newPl.images = [{ url: document.getElementById('album-art').src }];
      }
    } catch (e) { /* cover upload is best-effort */ }
  }
  playlists.unshift(newPl);
  renderPlaylists();
  document.getElementById('new-playlist-input').value = '';
  await addToPlaylist(newPl.id, newPl.name);
}

async function nextSong() {
  currentIndex++;
  await saveProgress();

  if (currentIndex >= totalTracks) {
    stopWaveform();
    stopTrackProgress();
    hide('sorter-wrap');
    document.getElementById('done-msg').textContent = 'All done! 🎉';
    show('done-screen');
    return;
  }

  await ensureTrack(currentIndex);
  showSong(currentIndex);
  playCurrentSong();
}

async function previousSong() {
  if (currentIndex <= 0) return;
  currentIndex--;
  await saveProgress();
  await ensureTrack(currentIndex);
  showSong(currentIndex);
  playCurrentSong();
}

// ---- Event listeners ----
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
