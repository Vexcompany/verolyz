// controllers/downloadController.js
// REFACTORED: Cloudflare R2 storage, no Supabase, no Catbox
// New endpoint: GET /api/stream?id=VIDEO_ID

const enhancedDownloader = require('../services/enhancedDownloader');
const r2Storage          = require('../services/r2Storage');
const jsonDb             = require('../services/jsonDatabase');

/**
 * GET /api/stream?id=VIDEO_ID
 *
 * Flow:
 *   1. Validate videoId
 *   2. Check R2 cache via enhancedDownloader (which checks r2Storage.fileExists)
 *   3. If miss → yt-dlp stream → upload to R2
 *   4. Return permanent R2 URL to client
 */
exports.stream = async (req, res, next) => {
    try {
        const { id: videoId } = req.query;

        if (!videoId || !/^[a-zA-Z0-9_\-]{6,12}$/.test(videoId)) {
            return res.status(400).json({
                status:  false,
                message: 'Parameter id (YouTube video ID) diperlukan dan harus valid',
            });
        }

        console.log('[stream] Request for videoId:', videoId);

        const result = await enhancedDownloader.getStreamUrl(videoId);

        // Update local JSON DB (best-effort, non-blocking)
        jsonDb.saveTrack({
            videoId,
            title:     result.title,
            artist:    result.artist,
            thumbnail: result.thumbnail,
            duration:  result.duration,
            r2Url:     result.url,
        }).catch(e => console.warn('[stream] jsonDb save failed (non-fatal):', e.message));

        return res.json({
            status: true,
            result: {
                videoId,
                title:     result.title,
                artist:    result.artist,
                thumbnail: result.thumbnail,
                duration:  result.duration,
                url:       result.url,       // permanent R2 URL
            },
        });

    } catch (error) {
        console.error('[stream] Error:', error.message);

        // Distinguish between client errors and server errors
        if (error.message.includes('Invalid videoId')) {
            return res.status(400).json({ status: false, message: error.message });
        }
        if (error.message.includes('yt-dlp')) {
            return res.status(502).json({
                status:  false,
                message: 'Gagal mengambil audio dari YouTube. Pastikan yt-dlp terinstall.',
            });
        }

        next(error);
    }
};

/**
 * GET /api/stream/info?id=VIDEO_ID
 * Returns metadata only (no download). Useful for UI pre-fill.
 */
exports.info = async (req, res, next) => {
    try {
        const { id: videoId } = req.query;

        if (!videoId) {
            return res.status(400).json({ status: false, message: 'id required' });
        }

        // Check if already cached in R2
        const filename  = r2Storage.buildFilename(videoId);
        const cachedUrl = await r2Storage.fileExists(filename);

        return res.json({
            status: true,
            videoId,
            cached: !!cachedUrl,
            url:    cachedUrl || null,
        });

    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/stream/tracks
 * Returns all tracks saved in the local JSON database.
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
 * Search tracks in the local JSON database.
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
