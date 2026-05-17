// services/appleDownloader.js
// Menggunakan Nexray API — https://api.nexray.eu.cc/downloader/applemusic?url=

const axios = require('axios');

const NEXRAY_BASE = 'https://api.nexray.eu.cc';

class AppleDownloaderService {

    /**
     * Download info + audio link dari Apple Music URL.
     * Interface sama agar enhancedDownloader.js tidak perlu diubah.
     *
     * @param {string} url - Apple Music track URL
     * @returns {Promise<{ status: true, result: { title, artist, image, download: { mp3, cover } } }>}
     */
    async download(url) {
        if (!url) throw new Error('URL diperlukan');
        if (!this.isValidAppleMusicUrl(url)) {
            throw new Error('URL tidak valid. Harus menggunakan URL Apple Music.');
        }

        console.log('[nexray] Apple Music download:', url.substring(0, 70));

        let res;
        try {
            res = await axios.get(`${NEXRAY_BASE}/downloader/applemusic`, {
                params:  { url },
                timeout: 60000, // nexray bisa lambat (~28 detik di contoh)
                headers: { 'User-Agent': 'PagaskaMusic/3.2.0' },
            });
        } catch (err) {
            const msg = err.response?.data?.message || err.message;
            throw new Error(`Nexray API error: ${msg}`);
        }

        const body = res.data;

        // Response: { status: true, result: { name, artist, thumbnail, url, ... } }
        if (!body?.status) {
            throw new Error(body?.message || 'Nexray API: request tidak berhasil');
        }

        const r = body.result || {};

        if (!r.url) {
            throw new Error('Nexray API tidak mengembalikan URL audio');
        }

        return {
            status: true,
            result: {
                title:    r.name       || 'Unknown',
                artist:   r.artist     || 'Unknown',
                image:    r.thumbnail  || null,
                duration: r.duration   || null,
                download: {
                    mp3:   r.url,
                    cover: r.thumbnail || null,
                },
            },
        };
    }

    isValidAppleMusicUrl(url) {
        return typeof url === 'string'
            && url.includes('music.apple.com')
            && (url.includes('/album/') || url.includes('/song/'));
    }
}

module.exports = new AppleDownloaderService();
