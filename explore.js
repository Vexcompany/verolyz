// ════════════════════════════════════════════════════════════════
//  explore.js — Pagaska Music
//  REFACTORED: Uses GET /api/stream?id=VIDEO_ID instead of Apple download
//  Fitur: Wrapped, Time Capsule, Voice Search, Karaoke, Admin
// ════════════════════════════════════════════════════════════════

// ── Backend base URL ─────────────────────────────────────────────
// Change this to your deployed backend URL in production.
const BACKEND_URL = window.BACKEND_URL || 'https://your-backend.onrender.com';

// ════════════════════════════════════════════════════════════════
//  STREAM HELPER — replaces old apple-download / catbox logic
// ════════════════════════════════════════════════════════════════

/**
 * Get a permanent R2 audio URL for the given YouTube video ID.
 * The backend handles the cache check + yt-dlp + R2 upload automatically.
 *
 * @param {string} videoId - YouTube video ID (e.g. "dQw4w9WgXcQ")
 * @returns {Promise<{ url: string, title: string, artist: string, thumbnail: string, duration: string }>}
 */
async function getStreamUrl(videoId) {
    if (!videoId) throw new Error('videoId is required');

    const res = await fetch(`${BACKEND_URL}/api/stream?id=${encodeURIComponent(videoId)}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Stream request failed (${res.status})`);
    }

    const data = await res.json();
    if (!data.status || !data.result?.url) {
        throw new Error(data.message || 'Invalid stream response');
    }

    return data.result;
}

/**
 * Play a track by YouTube video ID.
 * Replaces calls like: fetch('/api/apple-download', { method: 'POST', body: ... })
 *
 * Usage in index.html:
 *   PagaskaExplore.playById('dQw4w9WgXcQ', { title: 'Never Gonna Give You Up', ... })
 */
async function playById(videoId, prefilledMeta = {}) {
    if (!videoId) {
        toast('❌ Video ID tidak ditemukan');
        return;
    }

    toast('⏳ Memuat audio...');

    try {
        const result = await getStreamUrl(videoId);

        // Merge R2 result with any pre-filled metadata from search results
        const track = {
            id:        videoId,
            videoId:   videoId,
            title:     result.title     || prefilledMeta.title     || 'Unknown',
            artist:    result.artist    || prefilledMeta.artist    || 'Unknown',
            thumbnail: result.thumbnail || prefilledMeta.thumbnail || null,
            duration:  result.duration  || prefilledMeta.duration  || '0:00',
            url:       result.url,
        };

        // playTrackObj is defined in index.html — call it with the enriched track
        if (typeof playTrackObj === 'function') {
            playTrackObj(track);
        } else {
            // Fallback: set audio src directly
            const audioEl = document.getElementById('audioPlayer');
            if (audioEl) {
                audioEl.src = track.url;
                audioEl.play();
            }
        }

    } catch (err) {
        console.error('[playById]', err.message);
        toast('❌ Gagal memuat audio: ' + err.message);
    }
}

// ════════════════════════════════════════════════════════════════
//  VOICE SEARCH
// ════════════════════════════════════════════════════════════════
let recognition = null;
let isListening = false;

function initVoiceSearch() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        toast('⚠️ Browser tidak mendukung Voice Search');
        return false;
    }
    recognition = new SpeechRecognition();
    recognition.lang = 'id-ID';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
        isListening = true;
        updateVoiceUI(true);
        toast('🎤 Silakan ucapkan nama lagu...');
    };

    recognition.onresult = (e) => {
        const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
        document.getElementById('voiceText').textContent = transcript;
        if (e.results[e.results.length - 1].isFinal) {
            document.getElementById('sInput').value = transcript;
            setTimeout(() => { stopVoiceSearch(); doSearch(); }, 500);
        }
    };

    recognition.onerror  = (e) => { toast('❌ Voice error: ' + e.error); stopVoiceSearch(); };
    recognition.onend    = () => { isListening = false; updateVoiceUI(false); };
    return true;
}

function startVoiceSearch() {
    if (!recognition && !initVoiceSearch()) return;
    if (isListening) { stopVoiceSearch(); return; }
    document.getElementById('voiceModal').classList.add('open');
    document.getElementById('voiceText').textContent = 'Mendengarkan...';
    recognition.start();
}

function stopVoiceSearch() {
    if (recognition && isListening) recognition.stop();
    document.getElementById('voiceModal')?.classList.remove('open');
    updateVoiceUI(false);
}

function updateVoiceUI(listening) {
    const btn = document.getElementById('voiceSearchBtn');
    if (!btn) return;
    btn.classList.toggle('listening', listening);
    btn.querySelector('i').className = listening ? 'fas fa-stop' : 'fas fa-microphone';
}

// ════════════════════════════════════════════════════════════════
//  WRAPPED BULANAN
// ════════════════════════════════════════════════════════════════
async function loadWrapped() {
    const el = document.getElementById('wrappedContent');
    el.innerHTML = '<div style="text-align:center;padding:30px"><i class="fas fa-circle-notch spin" style="color:var(--dyn1);font-size:1.5rem"></i></div>';

    try {
        const now        = new Date();
        const month      = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

        const startOfMonth = `${month}-01`;
        const history = await sb.get('play_history',
            `user_key=eq.${encodeURIComponent(USER_KEY)}&played_at=gte.${startOfMonth}&order=played_at.desc`
        );

        if (!history.length) {
            el.innerHTML = `<div class="wrapped-empty">
        <i class="fas fa-calendar-times" style="font-size:2rem;color:var(--mt);display:block;margin-bottom:12px"></i>
        <div style="font-size:.9rem;color:var(--mt)">Belum ada data untuk ${monthLabel}</div>
        <div style="font-size:.75rem;color:var(--mt);margin-top:6px">Mulai putar lagu untuk generate Wrapped!</div>
      </div>`;
            return;
        }

        const trackCounts = {};
        history.forEach(h => { trackCounts[h.track_id] = (trackCounts[h.track_id] || 0) + 1; });

        const topTrackIds = Object.entries(trackCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);

        const topTracks = [];
        for (const id of topTrackIds) {
            try {
                const rows = await sb.get('tracks', `id=eq.${encodeURIComponent(id)}`);
                if (rows?.length) topTracks.push({ ...rows[0], plays: trackCounts[id] });
            } catch {}
        }

        const artistCounts = {};
        topTracks.forEach(t => {
            const artist = t.artist || 'Unknown';
            artistCounts[artist] = (artistCounts[artist] || 0) + t.plays;
        });
        const topArtists   = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const totalPlays   = history.length;
        const totalMins    = Math.round(totalPlays * 3.5);
        const username     = (session?.nama || '').split(' ')[0];

        el.innerHTML = `
      <div class="wrapped-card">
        <div class="wrapped-header">
          <div class="wrapped-month">${monthLabel}</div>
          <div class="wrapped-title">🎁 Wrapped ${username}</div>
        </div>
        <div class="wrapped-stats">
          <div class="wrapped-stat"><div class="wrapped-stat-val">${totalPlays}</div><div class="wrapped-stat-lbl">Lagu Diputar</div></div>
          <div class="wrapped-stat"><div class="wrapped-stat-val">${totalMins}</div><div class="wrapped-stat-lbl">Menit</div></div>
          <div class="wrapped-stat"><div class="wrapped-stat-val">${topArtists.length}</div><div class="wrapped-stat-lbl">Artis</div></div>
        </div>
        ${topTracks.length ? `
        <div class="wrapped-section">
          <div class="wrapped-sec-title">🎵 Top Lagu Bulan Ini</div>
          ${topTracks.map((t, i) => `
            <div class="wrapped-track" onclick='playTrackObj(${esc(rowToTrack(t, "db"))})'>
              <div class="wrapped-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div>
              <img src="${t.thumbnail || PH}" onerror="this.src='${PH}'" style="width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0">
              <div style="flex:1;min-width:0">
                <div style="font-size:.8rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.title}</div>
                <div style="font-size:.68rem;color:var(--mt)">${t.artist}</div>
              </div>
              <div style="font-size:.72rem;color:var(--dyn1);font-weight:700;flex-shrink:0">${t.plays}×</div>
            </div>`).join('')}
        </div>` : ''}
        ${topArtists.length ? `
        <div class="wrapped-section">
          <div class="wrapped-sec-title">🎤 Top Artis</div>
          ${topArtists.map((a, i) => `
            <div class="wrapped-artist">
              <div class="wrapped-artist-rank">${i + 1}</div>
              <div style="flex:1;font-size:.82rem;font-weight:600">${a[0]}</div>
              <div style="font-size:.7rem;color:var(--dyn1);font-weight:700">${a[1]} putar</div>
            </div>`).join('')}
        </div>` : ''}
        <button class="wrapped-share-btn" onclick="shareWrapped()">
          <i class="fas fa-share"></i> Bagikan Wrapped
        </button>
      </div>`;

    } catch (e) {
        el.innerHTML = `<div class="wrapped-empty"><i class="fas fa-exclamation-triangle" style="color:var(--rd);font-size:1.5rem;display:block;margin-bottom:8px"></i><div style="color:var(--mt);font-size:.82rem">Gagal load Wrapped: ${e.message}</div></div>`;
    }
}

function shareWrapped() {
    if (navigator.share) {
        navigator.share({ title: 'Pagaska Music Wrapped', text: 'Cek Wrapped bulanan saya di Pagaska Music! 🎵', url: window.location.origin }).catch(() => {});
    } else {
        navigator.clipboard?.writeText(window.location.origin).then(() => toast('Link disalin!'));
    }
}

// ════════════════════════════════════════════════════════════════
//  TIME CAPSULE
// ════════════════════════════════════════════════════════════════
let capsules       = [];
let currentCapsule = null;

async function loadCapsules() {
    const el = document.getElementById('capsuleList');
    el.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-circle-notch spin" style="color:var(--dyn1)"></i></div>';
    try {
        capsules = await sb.get('capsules', 'order=created_at.desc&limit=20');
        if (!capsules.length) {
            el.innerHTML = `<div class="empty-ti"><i class="fas fa-calendar-alt"></i>Belum ada Time Capsule<br><span style="font-size:.7rem">Buat capsule untuk mengarsipkan lagu Pagaska!</span></div>`;
            return;
        }
        el.innerHTML = capsules.map(c => `
      <div class="capsule-item" onclick="openCapsule(${c.id})">
        <div class="capsule-ico"><i class="fas fa-box-open"></i></div>
        <div class="capsule-inf">
          <div class="capsule-title">${c.title}</div>
          <div class="capsule-meta">${c.description || ''}</div>
          <div class="capsule-date"><i class="fas fa-calendar"></i> ${new Date(c.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <i class="fas fa-chevron-right" style="color:var(--mt);font-size:.8rem;flex-shrink:0"></i>
      </div>`).join('');
    } catch (e) {
        el.innerHTML = `<div class="empty-ti"><i class="fas fa-exclamation-triangle"></i>Gagal load: ${e.message}</div>`;
    }
}

async function openCapsule(id) {
    currentCapsule = capsules.find(c => c.id === id);
    if (!currentCapsule) return;
    document.getElementById('capsuleDetailTitle').textContent = currentCapsule.title;
    document.getElementById('capsuleDetailDesc').textContent  = currentCapsule.description || '';
    document.getElementById('capsuleDetailScreen').classList.add('open');
    await loadCapsuleTracks(id);
}

async function loadCapsuleTracks(capsuleId) {
    const el = document.getElementById('capsuleTrackList');
    el.innerHTML = '<div style="text-align:center;padding:16px"><i class="fas fa-circle-notch spin" style="color:var(--dyn1)"></i></div>';
    try {
        const items = await sb.get('capsule_tracks', `capsule_id=eq.${capsuleId}&order=added_at.asc`);
        if (!items.length) { el.innerHTML = '<div class="empty-ti"><i class="fas fa-music"></i>Belum ada lagu di capsule ini</div>'; return; }
        const tracks = [];
        for (const item of items) {
            try {
                const rows = await sb.get('tracks', `id=eq.${encodeURIComponent(item.track_id)}`);
                if (rows?.length) tracks.push({ ...rows[0], addedBy: item.added_by, addedAt: item.added_at });
            } catch {}
        }
        el.innerHTML = tracks.map((t, i) => {
            const addedBy = t.addedBy?.split('_').slice(0, -1).join(' ') || t.addedBy;
            return `<div class="ti" onclick='playTrackObj(${esc(rowToTrack(t, "db"))})'>
        <div class="ti-n">${i + 1}</div>
        <div class="ti-th"><img src="${t.thumbnail || PH}" onerror="this.src='${PH}'"></div>
        <div class="ti-inf">
          <div class="ti-t">${t.title}</div>
          <div class="ti-a">${t.artist} · oleh ${addedBy}</div>
        </div>
        <div class="ti-dur">${t.duration || ''}</div>
      </div>`;
        }).join('');
    } catch (e) {
        el.innerHTML = `<div class="empty-ti">Gagal load: ${e.message}</div>`;
    }
}

function closeCapsuleDetail() {
    document.getElementById('capsuleDetailScreen').classList.remove('open');
    currentCapsule = null;
}

async function createCapsule() {
    const title = document.getElementById('capsuleTitleInput').value.trim();
    const desc  = document.getElementById('capsuleDescInput').value.trim();
    if (!title) { toast('Isi judul capsule dulu!'); return; }
    const btn = document.getElementById('createCapsuleBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch spin"></i>';
    try {
        await sb.post('capsules', { title, description: desc, month: new Date().toISOString().slice(0, 7), created_by: USER_KEY, created_at: new Date().toISOString() });
        toast('✅ Time Capsule dibuat!');
        document.getElementById('createCapsuleModal').classList.remove('open');
        document.getElementById('capsuleTitleInput').value = '';
        document.getElementById('capsuleDescInput').value  = '';
        loadCapsules();
    } catch (e) { toast('Gagal buat capsule: ' + e.message); }
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Buat';
}

async function addCurrentTrackToCapsule() {
    if (!currentTrack)   { toast('Putar lagu dulu!');    return; }
    if (!currentCapsule) { toast('Buka capsule dulu!');  return; }
    try {
        await sb.post('capsule_tracks', { capsule_id: currentCapsule.id, track_id: currentTrack.id, added_by: USER_KEY, added_at: new Date().toISOString() });
        toast('✅ Lagu ditambahkan ke capsule!');
        loadCapsuleTracks(currentCapsule.id);
    } catch (e) { toast('Gagal tambah: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════
//  KARAOKE MODE
// ════════════════════════════════════════════════════════════════
let karaokeLines  = [];
let karaokeInt    = null;
let karaokeActive = false;

async function openKaraoke() {
    if (!currentTrack) { toast('Putar lagu dulu sebelum karaoke!'); navigate('beranda'); return; }
    navigate('karaoke');
    karaokeActive = true;
    updateKaraokeTrackInfo();
    document.getElementById('karaokeLines').innerHTML = '<div style="text-align:center;color:rgba(255,255,255,.5);padding:40px">Memuat lirik...</div>';
    const lyricsData = await fetchLyrics(currentTrack.title, currentTrack.artist);
    renderKaraokeLyrics(lyricsData);
}

function updateKaraokeTrackInfo() {
    if (!currentTrack) return;
    document.getElementById('karaokeTitle').textContent  = currentTrack.title;
    document.getElementById('karaokeArtist').textContent = currentTrack.artist;
    document.getElementById('karaokeBg').style.backgroundImage = `url('${currentTrack.thumbnail || PH}')`;
    document.getElementById('karaokePlay').innerHTML = isPlaying && !audio.paused ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
}

function renderKaraokeLyrics(data) {
    const el = document.getElementById('karaokeLines');
    if (!data) { el.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,.4);padding:40px;font-size:.9rem">Lirik tidak tersedia 🎵</div>'; return; }
    if (data.type === 'synced') {
        karaokeLines = data.data;
        el.innerHTML = karaokeLines.map((l, i) => `<div class="karaoke-line" id="kl-${i}">${l.text}</div>`).join('');
        startKaraokeSync();
    } else if (data.type === 'genius') {
        el.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,.5);padding:40px">Lirik synced tidak tersedia.<br><a href="${data.url}" target="_blank" style="color:var(--dyn1);text-decoration:none;font-weight:700;font-size:.85rem">Buka di Genius →</a></div>`;
    } else {
        const lines = (data.data || '').split('\n').filter(l => l.trim());
        karaokeLines = lines.map((text, i) => ({ time: i * 3, text }));
        el.innerHTML = karaokeLines.map((l, i) => `<div class="karaoke-line" id="kl-${i}">${l.text}</div>`).join('');
    }
}

function startKaraokeSync() {
    clearInterval(karaokeInt);
    karaokeInt = setInterval(() => {
        if (!karaokeLines.length || !audio.duration || !karaokeActive) return;
        const cur = audio.currentTime;
        let activeIdx = 0;
        for (let i = 0; i < karaokeLines.length; i++) { if (cur >= karaokeLines[i].time) activeIdx = i; }
        document.querySelectorAll('.karaoke-line').forEach((el, i) => {
            el.classList.remove('active', 'prev', 'next');
            if (i === activeIdx) el.classList.add('active');
            else if (i === activeIdx - 1) el.classList.add('prev');
            else if (i === activeIdx + 1) el.classList.add('next');
        });
        const active = document.getElementById(`kl-${activeIdx}`);
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
}

function stopKaraoke() { karaokeActive = false; clearInterval(karaokeInt); karaokeLines = []; navigate('beranda'); }

// ════════════════════════════════════════════════════════════════
//  ADMIN SPY MODE
// ════════════════════════════════════════════════════════════════
let adminMode = false;

function checkAdminLogin() {
    const stored = localStorage.getItem('pgsk_admin');
    if (stored === ADMIN_PASS) { adminMode = true; activateAdminMode(); }
}

function tryAdminLogin() {
    const pass = document.getElementById('adminPassInput').value;
    if (pass === ADMIN_PASS) {
        localStorage.setItem('pgsk_admin', pass);
        adminMode = true;
        activateAdminMode();
        document.getElementById('adminLoginModal').classList.remove('open');
        toast('🔐 Admin mode aktif');
    } else {
        toast('❌ Password salah');
        document.getElementById('adminPassInput').value = '';
    }
}

function activateAdminMode() {
    const indicator = document.createElement('div');
    indicator.id = 'adminIndicator';
    indicator.style.cssText = 'position:fixed;top:60px;right:8px;z-index:9999;background:rgba(255,77,109,.15);border:1px solid rgba(255,77,109,.3);border-radius:8px;padding:3px 8px;font-size:.6rem;font-weight:700;color:var(--rd);letter-spacing:1px';
    indicator.textContent = '🔐 ADMIN';
    document.body.appendChild(indicator);
    loadAdminChatView();
}

async function loadAdminChatView() {
    if (!adminMode) return;
    try {
        const allMessages = await sb.get('messages', 'order=created_at.desc&limit=100');
        const el = document.getElementById('adminChatView');
        if (!el) return;
        if (!allMessages.length) { el.innerHTML = '<div class="empty-ti">Belum ada pesan</div>'; return; }
        const convMap = {};
        allMessages.forEach(m => {
            const key = [m.from_key, m.to_key].sort().join('|');
            if (!convMap[key]) convMap[key] = [];
            convMap[key].push(m);
        });
        el.innerHTML = Object.entries(convMap).map(([key, msgs]) => {
            const [a, b] = key.split('|');
            const nameA  = a.split('_').slice(0, -1).join(' ');
            const nameB  = b.split('_').slice(0, -1).join(' ');
            return `<div style="background:var(--s2);border:1px solid var(--bd);border-radius:12px;padding:12px;margin-bottom:8px">
        <div style="font-size:.75rem;font-weight:700;color:var(--rd);margin-bottom:8px"><i class="fas fa-lock"></i> ${nameA} ↔ ${nameB}</div>
        ${msgs.slice(0, 5).map(m => {
                const from = m.from_key.split('_').slice(0, -1).join(' ');
                const time = new Date(m.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                return `<div style="font-size:.72rem;padding:4px 0;border-bottom:1px solid var(--bd);display:flex;gap:8px;align-items:flex-start">
            <span style="color:var(--p2);font-weight:600;flex-shrink:0">${from}:</span>
            <span style="color:var(--mt);flex:1">${m.track_id ? '🎵 ' + m.content : m.content || ''}</span>
            <span style="color:var(--mt);font-size:.6rem;flex-shrink:0">${time}</span>
          </div>`;
            }).join('')}
        ${msgs.length > 5 ? `<div style="font-size:.65rem;color:var(--mt);margin-top:6px">+${msgs.length - 5} pesan lainnya</div>` : ''}
      </div>`;
        }).join('');
    } catch (e) { console.warn('Admin chat view:', e.message); }
}

// ════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ════════════════════════════════════════════════════════════════
async function requestNotifPermission() {
    if (!('Notification' in window)) { toast('Browser tidak mendukung notifikasi'); return; }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        toast('✅ Notifikasi diaktifkan!');
        localStorage.setItem('pgsk_notif', 'true');
        updateNotifBtn(true);
    } else {
        toast('❌ Izin notifikasi ditolak');
    }
}

function sendBrowserNotif(title, body, icon) {
    if (Notification.permission !== 'granted') return;
    if (document.hasFocus()) return;
    new Notification(title, { body, icon: icon || '/favicon.ico', badge: '/favicon.ico' });
}

function updateNotifBtn(enabled) {
    const btn = document.getElementById('notifToggleBtn');
    if (!btn) return;
    btn.innerHTML = enabled ? '<i class="fas fa-bell"></i> Notifikasi Aktif' : '<i class="fas fa-bell-slash"></i> Aktifkan Notifikasi';
    btn.style.color = enabled ? 'var(--dyn1)' : 'var(--mt)';
}

// ════════════════════════════════════════════════════════════════
//  EXPOSE TO WINDOW
// ════════════════════════════════════════════════════════════════
window.PagaskaExplore = {
    // ★ NEW: stream helper exposed for index.html
    getStreamUrl,
    playById,

    // Existing features (unchanged API)
    startVoiceSearch,
    stopVoiceSearch,
    loadWrapped,
    loadCapsules,
    openCapsule,
    closeCapsuleDetail,
    createCapsule,
    addCurrentTrackToCapsule,
    openKaraoke,
    stopKaraoke,
    updateKaraokeTrackInfo,
    checkAdminLogin,
    tryAdminLogin,
    loadAdminChatView,
    requestNotifPermission,
    sendBrowserNotif,
};

document.addEventListener('DOMContentLoaded', () => {
    checkAdminLogin();
    updateNotifBtn(localStorage.getItem('pgsk_notif') === 'true');
});
