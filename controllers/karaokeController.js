// controllers/karaokeController.js
// Flow: trackId → R2 cache check → x-minus.pro separation → upload vocal+inst ke R2
// Pattern sama dengan downloadController.js

const axios     = require('axios');
const cheerio   = require('cheerio');
const FormData  = require('form-data');
const r2Storage = require('../services/r2Storage');

// ── x-minus.pro auth ─────────────────────────────────────────
async function getXminusAuth() {
    const res = await axios.get('https://x-minus.pro/ai', {
        timeout: 20000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
    });
    const $    = cheerio.load(res.data);
    const auth = {
        client_fp: $('#vocal-cut-fp').val()       || '',
        auth_key:  $('#vocal-cut-auth-key').val() || '',
    };
    if (!auth.auth_key) throw new Error('Gagal ambil auth dari x-minus.pro');
    return auth;
}

// ── Upload audio buffer ke x-minus.pro ───────────────────────
async function uploadToXminus(buffer, auth) {
    const form = new FormData();
    form.append('auth_key',            auth.auth_key);
    form.append('locale',              'en_US');
    form.append('separation',          'inst_vocal');
    form.append('separation_type',     'vocals_music');
    form.append('format',              'mp3');
    form.append('version',             '3-4-0');
    form.append('model',               'mdx_v2_vocft');
    form.append('aggressiveness',      '2');
    form.append('lvpanning',           'center');
    form.append('uvrbve_ct',           'auto');
    form.append('pre_rate',            '100');
    form.append('bve_preproc',         'auto');
    form.append('show_setting_format', '0');
    form.append('hostname',            'x-minus.pro');
    form.append('client_fp',           auth.client_fp);
    form.append('myfile', buffer, { filename: 'audio.mp3', contentType: 'audio/mpeg' });

    const res = await axios.post(
        'https://mmd.uvronline.app/upload/vocalCutAi?catch-file',
        form,
        {
            headers: {
                ...form.getHeaders(),
                'User-Agent': 'Mozilla/5.0',
                'origin':     'https://x-minus.pro',
                'referer':    'https://x-minus.pro/',
            },
            timeout: 90000,
        }
    );
    if (!res.data?.job_id) throw new Error('x-minus tidak mengembalikan job_id');
    return res.data.job_id;
}

// ── Poll job sampai selesai ───────────────────────────────────
async function pollJob(jobId, authKey, maxMs = 200000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        const form = new FormData();
        form.append('job_id',   jobId);
        form.append('auth_key', authKey);
        form.append('locale',   'en_US');

        const res = await axios.post(
            'https://mmd.uvronline.app/upload/vocalCutAi?check-job-status',
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'User-Agent': 'Mozilla/5.0',
                    'origin':     'https://x-minus.pro',
                    'referer':    'https://x-minus.pro/',
                },
                timeout: 20000,
            }
        );

        const st = (res.data?.status || '').toLowerCase();
        console.log(`[karaoke] job ${jobId}: ${st}`);
        if (['completed', 'done', 'success'].includes(st)) return res.data;
        if (['failed', 'error'].includes(st)) throw new Error('x-minus job gagal: ' + st);
        await new Promise(r => setTimeout(r, 4000));
    }
    throw new Error('Karaoke timeout (>3 menit)');
}

// ── Ambil redirect URL download dari x-minus ─────────────────
async function getXminusDownloadUrl(jobId, stem) {
    const url = `https://mmd.uvronline.app/dl/vocalCutAi?job-id=${jobId}&stem=${stem}&fmt=mp3&cdn=0`;
    try {
        const res = await axios.get(url, {
            maxRedirects:   0,
            validateStatus: s => s >= 200 && s < 400,
            headers: { 'User-Agent': 'Mozilla/5.0', 'referer': 'https://x-minus.pro/' },
            timeout: 20000,
        });
        return res.headers.location || null;
    } catch (e) {
        if (e.response?.headers?.location) return e.response.headers.location;
        throw new Error(`Gagal ambil URL ${stem}: ${e.message}`);
    }
}

// ── Download URL → Buffer ─────────────────────────────────────
async function downloadBuffer(url) {
    const res = await axios.get(url, {
        responseType:      'arraybuffer',
        timeout:           60000,
        maxContentLength:  50 * 1024 * 1024,
        headers:           { 'User-Agent': 'Mozilla/5.0' },
    });
    return Buffer.from(res.data);
}

// ── Safe filename helper (sama seperti r2Storage.buildFilename) ──
function safeId(id) {
    return (id || '').replace(/[^a-zA-Z0-9\-_]/g, '');
}

// ══════════════════════════════════════════════════════════════
//  POST /api/karaoke
//  Body: { trackId, audioUrl }
//  Returns: { status, trackId, cached, vocal, instrumental }
// ══════════════════════════════════════════════════════════════
exports.process = async (req, res, next) => {
    try {
        const { trackId, audioUrl } = req.body || {};
        if (!trackId)  return res.status(400).json({ status: false, message: 'trackId required' });
        if (!audioUrl) return res.status(400).json({ status: false, message: 'audioUrl required' });

        console.log('[karaoke] Request:', trackId);

        const safe         = safeId(trackId);
        const vocalFile    = `karaoke_${safe}_vocal.mp3`;
        const instFile     = `karaoke_${safe}_inst.mp3`;

        // ── 1. Cek R2 cache ───────────────────────────────────
        const [cachedVocal, cachedInst] = await Promise.all([
            r2Storage.fileExists(vocalFile),
            r2Storage.fileExists(instFile),
        ]);

        if (cachedVocal && cachedInst) {
            console.log('[karaoke] R2 cache hit:', trackId);
            return res.json({
                status: true, trackId, cached: true,
                vocal: cachedVocal, instrumental: cachedInst,
            });
        }

        // ── 2. Download audio sumber dari R2 URL ──────────────
        console.log('[karaoke] Downloading source audio...');
        const sourceBuffer = await downloadBuffer(audioUrl);

        // ── 3. Auth x-minus.pro ───────────────────────────────
        const auth = await getXminusAuth();

        // ── 4. Upload ke x-minus, dapat job_id ───────────────
        console.log('[karaoke] Uploading to x-minus...');
        const jobId = await uploadToXminus(sourceBuffer, auth);

        // ── 5. Poll job selesai ───────────────────────────────
        await pollJob(jobId, auth.auth_key);

        // ── 6. Ambil URL hasil ────────────────────────────────
        const [vocalDlUrl, instDlUrl] = await Promise.all([
            getXminusDownloadUrl(jobId, 'vocal'),
            getXminusDownloadUrl(jobId, 'inst'),
        ]);

        // ── 7. Download buffer vocal & instrumental ───────────
        const [vocalBuf, instBuf] = await Promise.all([
            downloadBuffer(vocalDlUrl),
            downloadBuffer(instDlUrl),
        ]);

        // ── 8. Upload keduanya ke R2 ──────────────────────────
        console.log('[karaoke] Uploading results to R2...');
        const [vocalR2, instR2] = await Promise.all([
            r2Storage.uploadBuffer(vocalBuf, vocalFile),
            r2Storage.uploadBuffer(instBuf,  instFile),
        ]);

        console.log('[karaoke] Done:', trackId);
        return res.json({
            status: true, trackId, cached: false,
            vocal: vocalR2, instrumental: instR2,
        });

    } catch (e) {
        console.error('[karaoke]', e.message);
        return res.status(502).json({ status: false, message: e.message });
    }
};

// ── GET /api/karaoke/status?trackId=xxx ──────────────────────
// Cek apakah karaoke sudah ada di cache R2 tanpa proses ulang
exports.status = async (req, res, next) => {
    try {
        const { trackId } = req.query;
        if (!trackId) return res.status(400).json({ status: false, message: 'trackId required' });

        const safe  = safeId(trackId);
        const [vocal, inst] = await Promise.all([
            r2Storage.fileExists(`karaoke_${safe}_vocal.mp3`),
            r2Storage.fileExists(`karaoke_${safe}_inst.mp3`),
        ]);

        return res.json({
            status:       true,
            trackId,
            cached:       !!(vocal && inst),
            vocal:        vocal || null,
            instrumental: inst  || null,
        });
    } catch (e) { next(e); }
};
