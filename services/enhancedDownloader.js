// services/enhancedDownloader.js
// Uses @distube/ytdl-core — pure Node.js, no binary needed, works on Vercel
// Flow: YouTube → ytdl stream → Cloudflare R2

const ytdl      = require('@distube/ytdl-core');
const r2Storage = require('./r2Storage');

class EnhancedDownloaderService {
    constructor() {
        // In-progress lock: videoId → Promise
        // Prevents duplicate concurrent uploads for the same video
        this.processing = new Map();
    }

    /**
     * Main entry: get a permanent R2 URL for the given YouTube video ID.
     * Flow:
     *   1. Check R2 (cache) → return URL immediately if hit
     *   2. Stream audio from YouTube via ytdl-core
     *   3. Upload stream directly to R2 (no temp file, no full buffer)
     *   4. Return permanent R2 URL
     *
     * @param {string} videoId
     * @returns {Promise<{ url, title, artist, thumbnail, duration }>}
     */
    async getStreamUrl(videoId) {
        if (!videoId || !/^[a-zA-Z0-9_\-]{6,12}$/.test(videoId)) {
            throw new Error('Invalid videoId format');
        }

        const filename = r2Storage.buildFilename(videoId);

        // ── 1. R2 cache check ────────────────────────────────────
        const cached = await r2Storage.fileExists(filename);
        if (cached) {
            console.log('[downloader] R2 cache hit:', videoId);
            const meta = await this._getMetadata(videoId);
            return { url: cached, ...meta };
        }

        // ── 2. Dedup: jika sedang diproses, tunggu ───────────────
        if (this.processing.has(videoId)) {
            console.log('[downloader] Waiting for in-flight upload:', videoId);
            return this.processing.get(videoId);
        }

        const promise = this._downloadAndUpload(videoId, filename);
        this.processing.set(videoId, promise);

        try {
            return await promise;
        } finally {
            this.processing.delete(videoId);
        }
    }

    /**
     * @private
     */
    async _downloadAndUpload(videoId, filename) {
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

        console.log('[downloader] Fetching info:', videoId);

        // Ambil info video (title, thumbnail, dll)
        let info;
        try {
            info = await ytdl.getInfo(youtubeUrl);
        } catch (err) {
            throw new Error(`Gagal ambil info video: ${err.message}`);
        }

        const videoDetails = info.videoDetails;

        // Pilih format audio terbaik (prefer webm/opus atau mp4a)
        const format = ytdl.chooseFormat(info.formats, {
            quality:   'highestaudio',
            filter:    'audioonly',
        });

        if (!format) {
            throw new Error('Tidak ada format audio tersedia untuk video ini');
        }

        console.log(`[downloader] Streaming audio (${format.container}, ${format.audioBitrate}kbps):`, videoId);

        // Buat stream dari ytdl
        const audioStream = ytdl.downloadFromInfo(info, { format });

        // Tangkap error stream sebelum mulai upload
        let streamError = null;
        audioStream.once('error', err => { streamError = err; });

        // Upload stream langsung ke R2
        let r2Url;
        try {
            r2Url = await r2Storage.uploadStream(audioStream, filename);
        } catch (err) {
            throw new Error(`Upload ke R2 gagal: ${streamError?.message || err.message}`);
        }

        const meta = {
            title:     videoDetails.title     || 'Unknown',
            artist:    videoDetails.author?.name || 'Unknown',
            thumbnail: videoDetails.thumbnails?.at(-1)?.url || null,
            duration:  this._secsToDuration(Number(videoDetails.lengthSeconds)),
        };

        console.log('[downloader] ✅ Done:', videoId, '→', r2Url.substring(0, 70));
        return { url: r2Url, ...meta };
    }

    /**
     * Ambil metadata saja (untuk cache hit) tanpa download audio.
     * @private
     */
    async _getMetadata(videoId) {
        try {
            const info   = await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${videoId}`);
            const detail = info.videoDetails;
            return {
                title:     detail.title           || 'Unknown',
                artist:    detail.author?.name     || 'Unknown',
                thumbnail: detail.thumbnails?.at(-1)?.url || null,
                duration:  this._secsToDuration(Number(detail.lengthSeconds)),
            };
        } catch {
            return { title: 'Unknown', artist: 'Unknown', thumbnail: null, duration: '0:00' };
        }
    }

    /** Convert seconds → "m:ss" */
    _secsToDuration(secs) {
        if (!secs || isNaN(secs)) return '0:00';
        const s = Math.floor(secs);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
}

module.exports = new EnhancedDownloaderService();
