// services/appleDownloader.js — REWRITE pakai nexray API
// Ganti aplmate (scraping, tidak reliable) → nexray (REST API, reliable)

const axios = require('axios');

class AppleDownloaderService {

    constructor() {
        this.nexrayBase = 'https://api.nexray.web.id/downloader/applemusic';
    }

    async download(url) {
        try {
            if (!this.isValidAppleMusicUrl(url)) {
                throw new Error('URL tidak valid. Harus menggunakan URL Apple Music.');
            }

            console.log('[nexray] Processing:', url.substring(0, 80));

            const response = await axios.get(this.nexrayBase, {
                params: { url },
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                }
            });

            const data = response.data;
            console.log('[nexray] Response keys:', Object.keys(data || {}));

            // Normalisasi berbagai kemungkinan format response nexray
            const mp3Url = data?.result?.url
                        || data?.result?.download
                        || data?.result?.audio
                        || data?.result?.mp3
                        || data?.download?.url
                        || data?.download?.mp3
                        || data?.audio
                        || data?.url
                        || data?.mp3
                        || null;

            // Ambil metadata dari semua kemungkinan field nexray
            const title  = data?.result?.title  || data?.result?.name
                        || data?.title          || data?.name
                        || data?.metadata?.title || null;
            const artist = data?.result?.artist  || data?.result?.singer
                        || data?.artist          || data?.singer
                        || data?.result?.author  || data?.author
                        || data?.metadata?.artist || null;
            const image  = data?.result?.image   || data?.result?.thumbnail
                        || data?.result?.cover   || data?.result?.artwork
                        || data?.image           || data?.thumbnail
                        || data?.cover           || null;
            const duration = data?.result?.duration || data?.result?.length
                          || data?.duration         || data?.length || null;

            if (!mp3Url) {
                console.error('[nexray] Full response:', JSON.stringify(data).substring(0, 300));
                throw new Error('nexray tidak mengembalikan URL audio');
            }

            return {
                status: true,
                result: {
                    title,
                    artist,
                    image,
                    duration,
                    download: {
                        mp3:     mp3Url,
                        cover:   image,
                        quality: data?.result?.quality || '128kbps'
                    }
                }
            };

        } catch (err) {
            // Kalau axios error (4xx/5xx), log response body untuk debug
            if (err.response) {
                console.error('[nexray] HTTP', err.response.status, JSON.stringify(err.response.data).substring(0, 200));
            }
            throw new Error(`Download failed: ${err.message}`);
        }
    }

    isValidAppleMusicUrl(url) {
        return url.includes('music.apple.com') &&
               (url.includes('/album/') || url.includes('/song/'));
    }
}

module.exports = new AppleDownloaderService();
