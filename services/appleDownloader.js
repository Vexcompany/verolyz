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
            console.log('[cuki] Response keys:', JSON.stringify(data).substring(0, 300));

            // Normalisasi berbagai kemungkinan format response
            const mp3Url = data?.result?.url
                        || data?.result?.download
                        || data?.result?.audio
                        || data?.result?.mp3
                        || data?.result?.link
                        || data?.download?.url
                        || data?.download?.mp3
                        || data?.download?.link
                        || data?.audio
                        || data?.url
                        || data?.mp3
                        || data?.link
                        || null;

            const title  = data?.result?.title    || data?.result?.name
                        || data?.title            || data?.name
                        || data?.metadata?.title  || null;
            const artist = data?.result?.artist   || data?.result?.singer
                        || data?.result?.author   || data?.artist
                        || data?.singer           || data?.author
                        || data?.metadata?.artist || null;
            const image  = data?.result?.image    || data?.result?.thumbnail
                        || data?.result?.cover    || data?.result?.artwork
                        || data?.image            || data?.thumbnail
                        || data?.cover            || null;
            const duration = data?.result?.duration || data?.result?.length
                          || data?.duration         || data?.length || null;

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
