// services/jsonDatabase.js
// Lightweight JSON file DB for track cache metadata.
// Keeps the existing structure, just replaces catbox fields → r2 fields.

const fs   = require('fs').promises;
const path = require('path');

class JsonDatabase {
    constructor() {
        const dataDir   = process.env.DATA_DIR
                       || (process.env.VERCEL ? '/tmp/pagaska-data' : path.join(__dirname, '../data'));
        this.dbPath     = path.join(dataDir, 'tracks.json');
        this._ready     = this._ensureDirectory(dataDir);
    }

    async _ensureDirectory(dir) {
        try { await fs.mkdir(dir, { recursive: true }); } catch {}
    }

    async _read() {
        try {
            await this._ready;
            return JSON.parse(await fs.readFile(this.dbPath, 'utf8'));
        } catch {
            return { tracks: [], lastUpdated: new Date().toISOString() };
        }
    }

    async _write(data) {
        try {
            await this._ready;
            data.lastUpdated = new Date().toISOString();
            await fs.writeFile(this.dbPath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.warn('[jsonDb] Write failed (non-fatal):', e.message);
        }
    }

    /**
     * Save or update a track record.
     * @param {{ videoId, title, artist, thumbnail, duration, r2Url }} trackData
     */
    async saveTrack(trackData) {
        const db  = await this._read();
        const idx = db.tracks.findIndex(t => t.videoId === trackData.videoId);

        const record = {
            videoId:   trackData.videoId,
            title:     trackData.title    || 'Unknown',
            artist:    trackData.artist   || 'Unknown',
            thumbnail: trackData.thumbnail || null,
            duration:  trackData.duration  || '0:00',
            r2: {
                url:        trackData.r2Url,
                uploadedAt: new Date().toISOString(),
            },
            metadata: {
                addedAt:       new Date().toISOString(),
                lastAccessed:  new Date().toISOString(),
                downloadCount: 1,
            },
        };

        if (idx >= 0) {
            record.metadata.addedAt       = db.tracks[idx].metadata?.addedAt || record.metadata.addedAt;
            record.metadata.downloadCount = (db.tracks[idx].metadata?.downloadCount || 0) + 1;
            db.tracks[idx] = record;
        } else {
            db.tracks.push(record);
        }

        await this._write(db);
        return record;
    }

    async findByVideoId(videoId) {
        const db = await this._read();
        return db.tracks.find(t => t.videoId === videoId) || null;
    }

    async getAllTracks(page = 1, limit = 50) {
        const db    = await this._read();
        const start = (page - 1) * limit;
        return {
            tracks:     db.tracks.slice(start, start + limit),
            total:      db.tracks.length,
            page,
            totalPages: Math.ceil(db.tracks.length / limit),
        };
    }

    async searchTracks(query) {
        const db  = await this._read();
        const nq  = query.toLowerCase();
        return db.tracks.filter(t =>
            (t.title  || '').toLowerCase().includes(nq) ||
            (t.artist || '').toLowerCase().includes(nq)
        );
    }
}

module.exports = new JsonDatabase();
