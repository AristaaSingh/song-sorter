let tracks = [];
let currentIndex = 0;
let totalTracks = 0;
let playlists = [];
let userId = '';

// --- UI helpers ---
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function toast(msg, color = '#1db954') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = color;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// --- Init ---
async function init() {
  const cfg = await window.spotify.getConfig();
  if (!cfg.clientId || !cfg.accessToken) {
    show('setup');
    if (cfg.clientId) document.getElementById('client-id-input').value = cfg.clientId;
    return;
  }
  await loadSorter();
}

// --- Auth ---
async function startAuth() {
  const clientId = document.getElementById('client-id-input').value.trim();
  if (!clientId) { toast('Enter your Client ID first', '#e74c3c'); return; }
  await window.spotify.saveClientId(clientId);
  hide('setup');
  show('loading');
  try {
    await window.spotify.authenticate(clientId);
    await loadSorter();
  } catch (e) {
    hide('loading');
    show('setup');
    toast('Auth failed — try again', '#e74c3c');
  }
}

// --- Load data ---
async function loadSorter() {
  show('loading');
  hide('setup');
  hide('sorter');
  hide('done-msg');

  const me = await window.spotify.getMe();
  userId = me.id;

  // Load first batch + total
  const first = await window.spotify.getLikedSongs({ offset: 0, limit: 50 });
  totalTracks = first.total;
  tracks = first.items;

  // Load playlists
  const pl = await window.spotify.getPlaylists();
  playlists = pl.items || [];

  hide('loading');

  if (totalTracks === 0) {
    show('done-msg');
    document.getElementById('done-msg').textContent = 'No liked songs found.';
    return;
  }

  currentIndex = 0;
  renderPlaylists();
  showSong(0);
  show('sorter');
}

// --- Fetch more tracks as needed ---
async function ensureTrack(index) {
  if (tracks[index]) return;
  const batch = await window.spotify.getLikedSongs({ offset: index, limit: 50 });
  batch.items.forEach((item, i) => { tracks[index + i] = item; });
}

// --- Render ---
function showSong(index) {
  const pct = totalTracks ? Math.round((index / totalTracks) * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `${index} / ${totalTracks}`;

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
    btn.onclick = () => addToPlaylist(pl.id, pl.name);
    list.appendChild(btn);
  });
}

// --- Actions ---
async function addToPlaylist(playlistId, playlistName) {
  const track = tracks[currentIndex]?.track;
  if (!track) return;
  await window.spotify.addToPlaylist({ playlistId, trackUri: track.uri });
  toast(`Added to ${playlistName}`);
  nextSong();
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
    hide('sorter');
    show('done-msg');
    document.getElementById('done-msg').textContent = 'All done! Every song has been sorted. 🎉';
    return;
  }
  await ensureTrack(currentIndex);
  showSong(currentIndex);
}

// --- Boot ---
document.getElementById('auth-btn').addEventListener('click', startAuth);
document.getElementById('create-add-btn').addEventListener('click', createAndAdd);
document.getElementById('skip-btn').addEventListener('click', nextSong);

init();
