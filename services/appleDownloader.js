// services/appleDownloader.js

const axios = require('axios');

class AppleDownloaderService {

    constructor() {
        this.cukiBase   = 'https://api.cuki.biz.id/api/downloader/musicapple';
        this.cukiApiKey = process.env.CUKI_API_KEY || 'cuki-x';
    }

    async download(url) {
        try {
            if (!this.isValidAppleMusicUrl(url)) {
                throw new Error('URL tidak valid. Harus menggunakan URL Apple Music.');
            }

            console.log('[cuki] Processing:', url.substring(0, 80));

            const response = await axios.get(this.cukiBase, {
                params: {
                    apikey: this.cukiApiKey,
                    url,
                },
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                }
            });

            const data = response.data;
            console.log('[cuki] Response:', JSON.stringify(data).substring(0, 300));

            // Format cuki: { success, data: { title, artist, cover, preview, download } }
            const d = data?.data || data?.result || data;

            const mp3Url   = d?.download || d?.mp3 || d?.audio || d?.url || d?.link || null;
            const title    = d?.title    || d?.name    || null;
            const artist   = d?.artist   || d?.singer  || null;
            const image    = d?.cover    || d?.image   || d?.thumbnail || null;
            const duration = d?.duration || d?.length  || null;

            if (!mp3Url) {
                console.error('[cuki] Full response:', JSON.stringify(data).substring(0, 500));
                throw new Error('cuki API tidak mengembalikan URL audio');
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
            if (err.response) {
                console.error('[cuki] HTTP', err.response.status, JSON.stringify(err.response.data).substring(0, 200));
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
