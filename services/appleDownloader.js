// services/appleDownloader.js — 

const axios    = require('axios');
const cheerio  = require('cheerio');
const FormData = require('form-data');
const crypto   = require('crypto');

class AppleDownloaderService {

    constructor() {
        this.baseUrl = 'https://aaplmusicdownloader.com';
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ];
    }

    // ── Helpers ────────────────────────────────────────────────

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _buildHeaders(cookies = '') {
        const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
        return {
            'User-Agent':                ua,
            'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language':           'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding':           'gzip, deflate, br',
            'Origin':                    this.baseUrl,
            'Referer':                   `${this.baseUrl}/`,
            'Sec-Ch-Ua':                 '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile':          '?0',
            'Sec-Ch-Ua-Platform':        '"Linux"',
            'Sec-Fetch-Dest':            'document',
            'Sec-Fetch-Mode':            'navigate',
            'Sec-Fetch-Site':            'same-origin',
            'Sec-Fetch-User':            '?1',
            'Upgrade-Insecure-Requests': '1',
            ...(cookies ? { Cookie: cookies } : {}),
        };
    }

    _parseCookies(headers, existing = {}) {
        const setCookies = headers['set-cookie'];
        if (!setCookies) return existing;
        const result = { ...existing };
        setCookies.forEach(c => {
            const m = c.match(/([^=]+)=([^;]+)/);
            if (m) result[m[1].trim()] = m[2].trim();
        });
        return result;
    }

    _cookieString(jar) {
        return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    _initCookieJar() {
        const phpsessid = crypto.randomBytes(16).toString('hex');
        const gaId      = `GA1.1.${Math.floor(Math.random() * 1e9)}.${Math.floor(Date.now() / 1000)}`;
        return { PHPSESSID: phpsessid, _ga: gaId };
    }

    // ── Step 1: ambil halaman utama (seed cookies) ─────────────

    async _getInitialPage(jar) {
        await this._sleep(2000);
        const res = await axios.get(this.baseUrl, {
            headers: this._buildHeaders(this._cookieString(jar)),
            timeout: 15000,
        });
        return this._parseCookies(res.headers, jar);
    }

    // ── Step 2: POST ke /song.php — ambil meta lagu ────────────

    async _searchSong(appleMusicUrl, jar) {
        await this._sleep(3000);

        // Ekstrak nama lagu dari URL Apple Music
        const urlMatch = appleMusicUrl.match(/\/song\/([^/]+)\/(\d+)/);
        const songName = urlMatch
            ? decodeURIComponent(urlMatch[1].replace(/-/g, ' '))
            : '';

        const requestData = [songName, '', '', '', null, appleMusicUrl];

        const form = new FormData();
        form.append('data', JSON.stringify(requestData));

        const res = await axios.post(`${this.baseUrl}/song.php`, form, {
            headers: {
                ...this._buildHeaders(this._cookieString(jar)),
                ...form.getHeaders(),
            },
            timeout: 20000,
            validateStatus: s => s === 200,
        });

        const newJar = this._parseCookies(res.headers, jar);
        return { html: res.data, jar: newJar };
    }

    // ── Step 3: POST ke /api/composer/swd.php — dapat dlink ────

    async _generateDownloadLink(trackName, artist, appleMusicUrl, quality, jar) {
        await this._sleep(2000);

        // Tambahkan cookie quality (umur 15 menit)
        const qualityJar = { ...jar, quality };

        const form = new FormData();
        form.append('song_name',    trackName);
        form.append('artist_name',  artist);
        form.append('url',          appleMusicUrl);
        form.append('token',        'none');
        form.append('zip_download', 'false');
        form.append('quality',      quality);

        const res = await axios.post(`${this.baseUrl}/api/composer/swd.php`, form, {
            headers: {
                ...this._buildHeaders(this._cookieString(qualityJar)),
                'X-Requested-With': 'XMLHttpRequest',
                ...form.getHeaders(),
            },
            timeout: 30000,
        });

        return res.data; // { status: 'success', dlink: '...' }
    }

    // ── Step 4: resolve redirect → URL final ───────────────────

    async _resolveFinalUrl(dlink, jar) {
        await this._sleep(1000);
        try {
            const res = await axios.get(`${this.baseUrl}/api/composer/ffmpeg/redirect.php`, {
                params:         { url: dlink },
                headers:        this._buildHeaders(this._cookieString(jar)),
                maxRedirects:   0,
                validateStatus: s => s === 302 || s === 200,
                timeout:        10000,
            });
            if (res.status === 302 && res.headers.location) {
                return res.headers.location;
            }
        } catch (err) {
            // Abaikan — pakai dlink asli sebagai fallback
        }
        return dlink;
    }

    // ── Public API — cocok dengan interface appleDownloader lama ─

    /**
     * Download info + link audio dari Apple Music URL.
     *
     * @param {string} url   - Apple Music track URL
     * @param {string} [quality='256'] - '64'|'128'|'192'|'256'|'320'|'m4a'
     * @returns {Promise<{ status: true, result: { title, artist, image, download: { mp3, cover } } }>}
     */
    async download(url, quality = '256') {
        if (!this.isValidAppleMusicUrl(url)) {
            throw new Error('URL tidak valid. Harus menggunakan URL Apple Music.');
        }

        // 1. Init sesi
        let jar = this._initCookieJar();

        // 2. Seed cookies
        jar = await this._getInitialPage(jar);

        // 3. Scrape metadata lagu
        const { html, jar: jar2 } = await this._searchSong(url, jar);
        jar = jar2;

        const $ = cheerio.load(html);
        const title     = $('h2').first().text().trim().replace(/[^\w\s]/g, '').trim();
        const artistRaw = $('.media-info p').first().text().trim();
        const artist    = artistRaw.split('|')[0].replace(/[^\w\s]/g, '').trim();
        const image     = $('meta[property="og:image"]').attr('content')
                       || $('.image.is-square img').attr('src')
                       || null;

        if (!title) {
            throw new Error('Gagal mengambil metadata lagu dari aaplmusicdownloader.com');
        }

        // 4. Generate download link
        const dlResult = await this._generateDownloadLink(title, artist, url, quality, jar);

        if (dlResult?.status !== 'success' || !dlResult?.dlink) {
            throw new Error(`Gagal mendapatkan link download (quality: ${quality})`);
        }

        // 5. Resolve redirect → URL final
        const mp3Url = await this._resolveFinalUrl(dlResult.dlink, jar);

        return {
            status: true,
            result: {
                title,
                artist,
                image,
                download: {
                    mp3:   mp3Url,
                    cover: image || null,
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
