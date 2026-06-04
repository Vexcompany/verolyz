// controllers/downloadController.js
// Flow: Apple Music URL → downloaderBalancer (Nexray↔Theresav) → R2 → return URL

const enhancedDownloader = require('../services/enhancedDownloader');
const downloaderBalancer = require('../services/downloaderBalancer');
const r2Storage          = require('../services/r2Storage');
const jsonDb             = require('../services/jsonDatabase');

/**
 * POST /api/stream
 * Body: { appleUrl, previewUrl, trackId, title, artist, thumbnail, duration }
 */
exports.stream = async (req, res, next) => {
    try {
        const body = req.method === 'POST' ? req.body : req.query;
        const { appleUrl, previewUrl, trackId, title, artist, thumbnail, duration } = body;

        if (!appleUrl && !previewUrl) {
            return res.status(400).json({
                status:  false,
                message: 'Parameter appleUrl atau previewUrl diperlukan',
            });
        }

        console.log('[stream] Request:', trackId || appleUrl?.substring(0, 60));

        const result = await enhancedDownloader.getStreamUrl({
            appleUrl, previewUrl, trackId, title, artist, thumbnail, duration,
        });

        jsonDb.saveTrack({
            videoId:   trackId || result.title,
            title:     result.title,
            artist:    result.artist,
            thumbnail: result.thumbnail,
            duration:  result.duration,
            r2Url:     result.url,
        }).catch(e => console.warn('[stream] jsonDb save failed:', e.message));

        return res.json({
            status: true,
            result: {
                trackId:   trackId || null,
                title:     result.title,
                artist:    result.artist,
                thumbnail: result.thumbnail,
                duration:  result.duration,
                url:       result.url,
                source:    result.source || null,
            },
        });

    } catch (error) {
        console.error('[stream] Error:', error.message);
        return res.status(502).json({
            status:  false,
            message: error.message || 'Gagal memproses audio',
        });
    }
};

/**
 * GET /api/stream/info?trackId=xxx
 */
exports.info = async (req, res, next) => {
    try {
        const { trackId } = req.query;
        if (!trackId) return res.status(400).json({ status: false, message: 'trackId required' });
        const filename  = r2Storage.buildFilename(trackId);
        const cachedUrl = await r2Storage.fileExists(filename);
        return res.json({ status: true, trackId, cached: !!cachedUrl, url: cachedUrl || null });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/stream/tracks
 */
exports.getAllTracks = async (req, res, next) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const data = await jsonDb.getAllTracks(Number(page), Number(limit));
        return res.json({ status: true, ...data });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/stream/search?q=query
 */
exports.searchLocal = async (req, res, next) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ status: false, message: 'q required' });
        const tracks = await jsonDb.searchTracks(q);
        return res.json({ status: true, data: tracks, total: tracks.length });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/stream/balancer-status
 * Cek status round-robin balancer (untuk debugging/monitoring).
 */
exports.balancerStatus = async (req, res) => {
    return res.json({
        status: true,
        balancer: downloaderBalancer.getStatus(),
    });
};
