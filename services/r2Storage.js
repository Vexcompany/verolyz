// services/r2Storage.js
// Cloudflare R2 Storage via AWS SDK v3 (S3-compatible)
// Replaces: supabaseStorage.js + catboxService.js

const {
    S3Client,
    PutObjectCommand,
    HeadObjectCommand,
    GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ── Config ──────────────────────────────────────────────────────
const R2_ENDPOINT        = process.env.R2_ENDPOINT;         // https://<ACCOUNT_ID>.r2.cloudflarestorage.com
const R2_ACCESS_KEY_ID   = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME     = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL      = process.env.R2_PUBLIC_URL;       // e.g. https://cdn.yourdomain.com  (optional)

if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error(
        '[r2Storage] Missing R2 env vars. ' +
        'Need: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME'
    );
}

// ── S3 Client pointing at R2 ────────────────────────────────────
const s3 = new S3Client({
    region:   'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId:     R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    // R2 does not support path-style forcing, but keeps SDK happy
    forcePathStyle: false,
});

class R2StorageService {

    /**
     * Upload a readable stream directly to R2.
     * No full buffering — data flows straight from yt-dlp → R2.
     *
     * @param {import('stream').Readable} stream  - Readable audio stream
     * @param {string}                   filename - e.g. "dQw4w9WgXcQ.mp3"
     * @returns {Promise<string>}                 - Public / signed URL
     */
    async uploadStream(stream, filename) {
        console.log('[r2] Uploading stream:', filename);

        const command = new PutObjectCommand({
            Bucket:      R2_BUCKET_NAME,
            Key:         filename,
            Body:        stream,
            ContentType: 'audio/mpeg',
        });

        await s3.send(command);
        console.log('[r2] ✅ Upload complete:', filename);

        return this.getPublicUrl(filename);
    }

    /**
     * Upload a Buffer to R2 (fallback when stream is not available).
     *
     * @param {Buffer} buffer
     * @param {string} filename
     * @returns {Promise<string>}
     */
    async uploadBuffer(buffer, filename) {
        console.log(`[r2] Uploading buffer (${(buffer.length / 1024 / 1024).toFixed(2)} MB):`, filename);

        const command = new PutObjectCommand({
            Bucket:         R2_BUCKET_NAME,
            Key:            filename,
            Body:           buffer,
            ContentType:    'audio/mpeg',
            ContentLength:  buffer.length,
        });

        await s3.send(command);
        console.log('[r2] ✅ Buffer upload complete:', filename);

        return this.getPublicUrl(filename);
    }

    /**
     * Check if a file already exists in R2.
     *
     * @param {string} filename
     * @returns {Promise<string|null>} - URL if exists, null otherwise
     */
    async fileExists(filename) {
        try {
            await s3.send(new HeadObjectCommand({
                Bucket: R2_BUCKET_NAME,
                Key:    filename,
            }));
            console.log('[r2] Cache hit:', filename);
            return this.getPublicUrl(filename);
        } catch (err) {
            // 404 / NoSuchKey → file doesn't exist
            if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
                return null;
            }
            // Re-throw unexpected errors (auth failures, etc.)
            console.error('[r2] HeadObject error:', err.message);
            throw err;
        }
    }

    /**
     * Returns the public URL for a file.
     * Uses R2_PUBLIC_URL if set (custom domain / CDN), otherwise a signed URL.
     *
     * @param {string} filename
     * @returns {string|Promise<string>}
     */
    getPublicUrl(filename) {
        if (R2_PUBLIC_URL) {
            return `${R2_PUBLIC_URL.replace(/\/$/, '')}/${filename}`;
        }
        // Fallback: generate a pre-signed URL valid for 1 hour
        return this.getSignedUrl(filename);
    }

    /**
     * Generate a pre-signed GET URL (expires in 3600 seconds by default).
     *
     * @param {string} filename
     * @param {number} [expiresIn=3600]
     * @returns {Promise<string>}
     */
    async getSignedUrl(filename, expiresIn = 3600) {
        const command = new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key:    filename,
        });
        return getSignedUrl(s3, command, { expiresIn });
    }

    /**
     * Sanitize a videoId into a safe filename.
     * @param {string} videoId
     * @returns {string}
     */
    buildFilename(videoId) {
        // Strip anything that's not alphanumeric, dash or underscore
        const safe = videoId.replace(/[^a-zA-Z0-9\-_]/g, '');
        return `${safe}.mp3`;
    }
}

module.exports = new R2StorageService();
