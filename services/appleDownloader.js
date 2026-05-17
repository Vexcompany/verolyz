// services/appleDownloader.js
// Menggunakan Ferdev API — https://api.ferdev.my.id/downloader/applemusic
// Set env: FERDEV_API_KEY=your_api_key

const axios = require('axios');

const FERDEV_API_KEY = process.env.FERDEV_API_KEY || '';
const FERDEV_BASE    = 'https://api.ferdev.my.id';

class AppleDownloaderService {

    /**
     * Download info + audio link dari Apple Music URL.
     * Interface sama dengan versi lama agar enhancedDownloader.js tidak perlu diubah.
     *
     * @param {string} url - Apple Music track URL
     * @returns {Promise<{ status: true, result: { title, artist, image, download: { mp3, cover } } }>}
     */
    async download(url) {
        if (!url) throw new Error('URL diperlukan');
        if (!this.isValidAppleMusicUrl(url)) {
            throw new Error('URL tidak valid. Harus menggunakan URL Apple Music.');
        }

        console.log('[ferdev] Apple Music download:', url.substring(0, 70));

        const params = { link: url };
        if (FERDEV_API_KEY) params.apikey = FERDEV_API_KEY;

        let res;
        try {
            res = await axios.get(`${FERDEV_BASE}/downloader/applemusic`, {
                params,
                timeout: 30000,
                headers: { 'User-Agent': 'PagaskaMusic/3.2.0' },
            });
        } catch (err) {
            const msg = err.response?.data?.message || err.message;
            throw new Error(`Ferdev API error: ${msg}`);
        }

        const body = res.data;

        // Ferdev mengembalikan { success: true, status: 200, data: { ... } }
        if (!body?.success) {
            throw new Error(body?.message || 'Ferdev API: request tidak berhasil');
        }

        const d = body.data || {};

        // Cari URL audio — coba berbagai field yang umum dipakai Ferdev
        const mp3 = d.download_url
                 || d.downloadUrl
                 || d.audio_url
                 || d.audio
                 || d.mp3
                 || d.stream_url
                 || d.url
                 || this._findAudioUrl(d);

        if (!mp3) {
            throw new Error('Ferdev API tidak mengembalikan URL audio');
        }

        const artistRaw = d.artist || d.author || d.artists;
        const artist = Array.isArray(artistRaw)
            ? artistRaw.join(', ')
            : (artistRaw || 'Unknown');

        const image = d.thumbnail
                   || d.cover
                   || d.image
                   || d.artwork
                   || d.album?.images?.[0]?.url
                   || null;

        return {
            status: true,
            result: {
                title:    d.title || d.name || 'Unknown',
                artist,
                image,
                download: {
                    mp3,
                    cover: image,
                },
            },
        };
    }

    /**
     * Cari URL audio dari nested object (1 level dalam).
     * Fallback kalau field utama tidak ditemukan.
     */
    _findAudioUrl(obj) {
        if (!obj || typeof obj !== 'object') return null;
        const audioKeys = ['download_url', 'audio', 'mp3', 'stream_url', 'url', 'href', 'link'];
        for (const key of audioKeys) {
            if (typeof obj[key] === 'string' && obj[key].startsWith('http')) {
                return obj[key];
            }
        }
        for (const val of Object.values(obj)) {
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                for (const key of audioKeys) {
                    if (typeof val[key] === 'string' && val[key].startsWith('http')) {
                        return val[key];
                    }
                }
            }
        }
        return null;
    }

    isValidAppleMusicUrl(url) {
        return typeof url === 'string'
            && url.includes('music.apple.com')
            && (url.includes('/album/') || url.includes('/song/'));
    }
}

module.exports = new AppleDownloaderService();
