// services/enhancedDownloader.js
// Flow: Apple Music URL → nexray API → mp3 buffer → Cloudflare R2
// Tidak pakai yt-dlp, tidak pakai ytdl-core — pure Node.js, Vercel-ready

const axios           = require('axios');
const appleDownloader = require('./appleDownloader');
const r2Storage       = require('./r2Storage');

class EnhancedDownloaderService {
    constructor() {
        // Lock: cacheKey → Promise (cegah upload duplikat bersamaan)
        this.processing = new Map();
    }

    /**
     * Main entry — dipanggil dari downloadController.
     *
     * @param {object} params
     * @param {string} params.appleUrl   - Apple Music track URL
     * @param {string} params.previewUrl - iTunes preview URL (fallback 30 detik)
     * @param {string} params.trackId    - ID unik untuk cache key
     * @param {string} [params.title]
     * @param {string} [params.artist]
     * @param {string} [params.thumbnail]
     * @param {string} [params.duration]
     * @returns {Promise<{ url, title, artist, thumbnail, duration }>}
     */
    async getStreamUrl({ appleUrl, previewUrl, trackId, title, artist, thumbnail, duration }) {
        if (!appleUrl && !previewUrl) {
            throw new Error('appleUrl atau previewUrl diperlukan');
        }

        const cacheKey = trackId || this._makeKey(appleUrl);
        const filename = r2Storage.buildFilename(cacheKey);

        // ── 1. Cek R2 cache dulu ─────────────────────────────────
        const cached = await r2Storage.fileExists(filename);
        if (cached) {
            console.log('[downloader] R2 cache hit:', cacheKey);
            return {
                url:       cached,
                title:     title     || null,
                artist:    artist    || null,
                thumbnail: thumbnail || null,
                duration:  duration  || '0:00',
            };
        }

        // ── 2. Dedup: kalau sedang diproses, tunggu ──────────────
        if (this.processing.has(cacheKey)) {
            console.log('[downloader] Menunggu upload in-flight:', cacheKey);
            return this.processing.get(cacheKey);
        }

        const promise = this._downloadAndUpload({
            appleUrl, previewUrl, cacheKey, filename,
            title, artist, thumbnail, duration,
        });
        this.processing.set(cacheKey, promise);

        try {
            return await promise;
        } finally {
            this.processing.delete(cacheKey);
        }
    }

    /** @private */
    async _downloadAndUpload({ appleUrl, previewUrl, cacheKey, filename, title, artist, thumbnail, duration }) {
        let mp3Url  = null;
        let metaOut = { title, artist, thumbnail, duration };

        // ── A. Coba nexray API dulu (full quality) ───────────────
        if (appleUrl) {
            try {
                console.log('[downloader] Mencoba nexray untuk:', cacheKey);
                const dlResult = await appleDownloader.download(appleUrl);
                mp3Url = dlResult?.result?.download?.mp3 || null;
                metaOut = {
                    title:     dlResult?.result?.title    || title     || null,
                    artist:    dlResult?.result?.artist   || artist    || null,
                    thumbnail: dlResult?.result?.image    || thumbnail || null,
                    duration:  dlResult?.result?.duration || duration  || '0:00',
                };
            } catch (err) {
                console.warn('[downloader] nexray gagal, fallback ke previewUrl:', err.message);
            }
        }

        // ── B. Fallback: iTunes previewUrl (30 detik) ────────────
        if (!mp3Url && previewUrl) {
            console.log('[downloader] Pakai previewUrl sebagai fallback:', cacheKey);
            mp3Url = previewUrl;
        }

        if (!mp3Url) {
            throw new Error('Tidak bisa mendapatkan URL audio. Coba lagu lain.');
        }

        // ── C. Download ke buffer ────────────────────────────────
        console.log('[downloader] Download buffer dari:', mp3Url.substring(0, 80));
        const buffer = await this._downloadBuffer(mp3Url);

        // ── D. Upload buffer ke R2 ───────────────────────────────
        const r2Url = await r2Storage.uploadBuffer(buffer, filename);

        console.log('[downloader] ✅ Selesai:', cacheKey, '→', r2Url.substring(0, 70));
        return { url: r2Url, ...metaOut };
    }

    /** @private — Download URL → Buffer */
    async _downloadBuffer(url) {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            maxContentLength: 50 * 1024 * 1024,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });
        return Buffer.from(response.data);
    }

    /** @private — Buat cache key dari Apple Music URL */
    _makeKey(url) {
        const m = url?.match(/[?&]i=(\d+)/);
        if (m) return `apple_${m[1]}`;
        return 'apple_' + Buffer.from(url || String(Date.now()))
            .toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
    }
}

module.exports = new EnhancedDownloaderService();
