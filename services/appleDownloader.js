// services/appleDownloader.js — scraper aplmate.com
// @creator AgungDevX, adapted for verolyz project

const axios   = require('axios');
const cheerio = require('cheerio');
const { zencf } = require('zencf');

class AppleDownloaderService {

    async download(url) {
        try {
            if (!this.isValidAppleMusicUrl(url)) {
                throw new Error('URL tidak valid. Harus menggunakan URL Apple Music.');
            }

            console.log('[-] Nyobian bypass Turnstile...');

            const { token } = await zencf.turnstileMin(
                'https://aplmate.com/',
                '0x4AAAAAABdqfzl6we62dQyp'
            );

            if (!token) throw new Error('Gagal meunangkeun token bypass!');
            console.log('[+] Bypass Berhasil!');

            const base = 'https://aplmate.com';
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
                'Origin':  base,
                'Referer': base + '/'
            };

            // Ambil CSRF & Session
            const home = await axios.get(base, { headers });
            const $h = cheerio.load(home.data);
            const csrfInput = $h("input[type='hidden']").filter((i, el) => $h(el).attr('name')?.startsWith('_'));
            const csrfName  = csrfInput.attr('name');
            const csrfValue = csrfInput.attr('value');
            const session   = home.headers['set-cookie']?.[0]?.split(';')[0] || '';

            // POST ke /action
            const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
            let formData  = `--${boundary}\r\nContent-Disposition: form-data; name="url"\r\n\r\n${url}\r\n`;
            formData     += `--${boundary}\r\nContent-Disposition: form-data; name="${csrfName}"\r\n\r\n${csrfValue}\r\n`;
            formData     += `--${boundary}\r\nContent-Disposition: form-data; name="cf-turnstile-response"\r\n\r\n${token}\r\n--${boundary}--\r\n`;

            const action = await axios.post(`${base}/action`, formData, {
                headers: {
                    ...headers,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Cookie': session
                }
            });

            const $res = cheerio.load(action.data.html || action.data);
            const trackData = {
                data:  $res("input[name='data']").attr('value'),
                base:  $res("input[name='base']").attr('value'),
                token: $res("input[name='token']").attr('value')
            };

            if (!trackData.data) throw new Error('Data track teu kapanggih dina response!');

            // POST ke /action/track
            const tBoundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
            let tForm  = `--${tBoundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${trackData.data}\r\n`;
            tForm     += `--${tBoundary}\r\nContent-Disposition: form-data; name="base"\r\n\r\n${trackData.base}\r\n`;
            tForm     += `--${tBoundary}\r\nContent-Disposition: form-data; name="token"\r\n\r\n${trackData.token}\r\n--${tBoundary}--\r\n`;

            const final = await axios.post(`${base}/action/track`, tForm, {
                headers: {
                    ...headers,
                    'Content-Type': `multipart/form-data; boundary=${tBoundary}`,
                    'Cookie': session
                }
            });

            const $f = cheerio.load(final.data.data || final.data);

            return {
                status: true,
                result: {
                    title:  $res('.aplmate-downloader-middle h3 div').text().trim(),
                    artist: $res('.aplmate-downloader-middle p span').text().trim(),
                    image:  $res('.aplmate-downloader-left img').attr('src'),
                    download: {
                        mp3:   base + $f("a:contains('Download Mp3')").attr('href'),
                        cover: base + $f("a:contains('Download Cover')").attr('href')
                    }
                }
            };

        } catch (err) {
            throw new Error(`Download failed: ${err.message}`);
        }
    }

    isValidAppleMusicUrl(url) {
        return url.includes('music.apple.com') &&
               (url.includes('/album/') || url.includes('/song/'));
    }
}

module.exports = new AppleDownloaderService();
