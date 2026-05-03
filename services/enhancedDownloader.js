// services/enhancedDownloader.js
// REFACTORED: yt-dlp audio stream → Cloudflare R2
// Removed: catboxService, appleDownloader dependency for stream

const { spawn }  = require('child_process');
const { Readable } = require('stream');
const r2Storage  = require('./r2Storage');

class EnhancedDownloaderService {
    constructor() {
        // In-progress lock: videoId → Promise
        // Prevents duplicate concurrent uploads for the same video
        this.processing = new Map();
    }

    /**
     * Main entry: get a permanent R2 URL for the given YouTube video ID.
     * Flow:
     *   1. Check R2 (cache) → return URL if hit
     *   2. Get audio stream from YouTube via yt-dlp
     *   3. Pipe stream directly to R2
     *   4. Return permanent R2 URL
     *
     * @param {string} videoId  - YouTube video ID (e.g. "dQw4w9WgXcQ")
     * @returns {Promise<{ url: string, title: string, artist: string, thumbnail: string, duration: string }>}
     */
    async getStreamUrl(videoId) {
        if (!videoId || !/^[a-zA-Z0-9_\-]{6,12}$/.test(videoId)) {
            throw new Error('Invalid videoId format');
        }

        const filename = r2Storage.buildFilename(videoId);

        // ── 1. Cache check ───────────────────────────────────────
        const cached = await r2Storage.fileExists(filename);
        if (cached) {
            console.log('[downloader] R2 cache hit:', videoId);
            // Still fetch metadata for title/artist/thumbnail
            const meta = await this._getMetadata(videoId);
            return { url: cached, ...meta };
        }

        // ── 2. Dedup in-flight uploads ───────────────────────────
        if (this.processing.has(videoId)) {
            console.log('[downloader] Waiting for in-flight upload:', videoId);
            return this.processing.get(videoId);
        }

        const uploadPromise = this._downloadAndUpload(videoId, filename);
        this.processing.set(videoId, uploadPromise);

        try {
            const result = await uploadPromise;
            return result;
        } finally {
            this.processing.delete(videoId);
        }
    }

    /**
     * Download audio from YouTube via yt-dlp and stream it to R2.
     *
     * @private
     * @param {string} videoId
     * @param {string} filename
     */
    async _downloadAndUpload(videoId, filename) {
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

        // Fetch metadata in parallel with starting the stream
        const metaPromise = this._getMetadata(videoId);

        // ── Stream audio directly from yt-dlp → R2 ──────────────
        console.log('[downloader] Starting yt-dlp stream for:', videoId);

        const audioStream = await this._spawnYtDlpStream(youtubeUrl);
        const r2Url       = await r2Storage.uploadStream(audioStream, filename);

        const meta = await metaPromise;
        console.log('[downloader] ✅ Done:', videoId, '→', r2Url.substring(0, 60));

        return { url: r2Url, ...meta };
    }

    /**
     * Spawns yt-dlp and returns a Readable stream of the audio.
     * Uses best audio quality available, re-encoded to mp3 128k.
     *
     * @private
     * @param {string} youtubeUrl
     * @returns {Promise<Readable>}
     */
    _spawnYtDlpStream(youtubeUrl) {
        return new Promise((resolve, reject) => {
            const args = [
                '--no-playlist',
                '--quiet',
                '--no-warnings',
                '-f', 'bestaudio[ext=m4a]/bestaudio/best',
                '--audio-format', 'mp3',
                '--audio-quality', '128K',
                '-x',                    // extract audio
                '-o', '-',               // output to stdout
                youtubeUrl,
            ];

            const proc = spawn('yt-dlp', args, {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stderr = '';
            proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

            proc.on('error', err => {
                reject(new Error(`yt-dlp spawn failed: ${err.message}. Is yt-dlp installed?`));
            });

            proc.on('close', code => {
                if (code !== 0 && !proc.stdout.readableEnded) {
                    reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-300)}`));
                }
            });

            // Resolve as soon as data starts flowing
            proc.stdout.once('data', () => {
                resolve(proc.stdout);
            });

            // If process exits before emitting data
            proc.stdout.once('end', () => {
                if (proc.exitCode !== 0) {
                    reject(new Error(`yt-dlp exited early. ${stderr.slice(-300)}`));
                }
            });
        });
    }

    /**
     * Get video metadata (title, artist, thumbnail, duration) via yt-dlp JSON.
     * Runs separately so it doesn't block the stream pipeline.
     *
     * @private
     * @param {string} videoId
     * @returns {Promise<{ title: string, artist: string, thumbnail: string, duration: string }>}
     */
    _getMetadata(videoId) {
        return new Promise((resolve) => {
            const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

            const proc = spawn('yt-dlp', [
                '--no-playlist',
                '--quiet',
                '--no-warnings',
                '--dump-json',
                youtubeUrl,
            ], { stdio: ['ignore', 'pipe', 'ignore'] });

            let raw = '';
            proc.stdout.on('data', chunk => { raw += chunk.toString(); });

            proc.on('close', () => {
                try {
                    const json = JSON.parse(raw);
                    resolve({
                        title:     json.title       || 'Unknown',
                        artist:    json.uploader     || json.channel || 'Unknown',
                        thumbnail: json.thumbnail    || null,
                        duration:  this._secsToDuration(json.duration),
                    });
                } catch {
                    // Metadata is non-critical — return defaults
                    resolve({ title: 'Unknown', artist: 'Unknown', thumbnail: null, duration: '0:00' });
                }
            });

            proc.on('error', () => {
                resolve({ title: 'Unknown', artist: 'Unknown', thumbnail: null, duration: '0:00' });
            });
        });
    }

    /**
     * Convert seconds (integer) to "m:ss" format.
     * @private
     */
    _secsToDuration(secs) {
        if (!secs) return '0:00';
        const s = Math.floor(secs);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
}

module.exports = new EnhancedDownloaderService();
