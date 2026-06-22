// services/appleSearch.js — v3
// Primary: Theresav API (https://api.theresav.biz.id/search/applemusic)
// Fallback: iTunes Search API

const axios = require('axios');

class AppleSearchService {

    async search(query, region = 'id') {
        try {
            return await this.searchByTheresav(query);
        } catch (err) {
            console.warn('[appleSearch] Theresav gagal, fallback ke iTunes API:', err.message);
            return await this.searchByITunes(query, region);
        }
    }

    /**
     * Primary: Theresav Apple Music Search
     * GET https://api.theresav.biz.id/search/applemusic?q=...&apikey=...
     *
     * Response shape:
     * {
     *   status: true,
     *   query: "...",
     *   total: 6,
     *   results: [
     *     { title, artist, link, image }
     *   ]
     * }
     */
    async searchByTheresav(query) {
        const apikey = process.env.THERESAV_API_KEY;
        if (!apikey) throw new Error('THERESAV_API_KEY env var tidak di-set');

        const { data } = await axios.get('https://api.theresav.biz.id/search/applemusic', {
            params: { q: query, apikey },
            timeout: 15000,
            headers: { 'User-Agent': 'PagaskaMusic/3.2.0' },
        });

        if (!data?.status || !Array.isArray(data.results)) {
            throw new Error(data?.message || 'Theresav search: response tidak valid');
        }

        if (!data.results.length) {
            throw new Error('Theresav search: tidak ada hasil');
        }

        const results = data.results.map((r, i) => {
            // "Song · Idgitaf" atau "Album · Idgitaf" → strip prefix
            const artistClean = (r.artist || '')
                .replace(/^(Song|Album|Artist|Playlist)\s*[·•]\s*/i, '')
                .trim();

            // Deteksi type dari prefix artist field & link
            const type = this._detectTypeFromArtist(r.artist) || this._detectTypeFromLink(r.link);

            // Extract trackId dari link Apple Music (?i=...)
            const trackId = this._extractTrackId(r.link);

            return {
                id:         trackId || `theresav_${i}`,
                title:      r.title  || 'Unknown',
                artist:     artistClean || 'Unknown',
                link:       r.link   || null,
                image:      r.image  || null,
                // Theresav search tidak kasih previewUrl/duration
                previewUrl: null,
                duration:   null,
                album:      null,
                year:       null,
                type,
                source:     'theresav',
            };
        });

        return {
            status: true,
            query,
            region: 'us', // Theresav pakai US store
            total: results.length,
            data: results,
        };
    }

    /**
     * Fallback: iTunes Search API
     */
    async searchByITunes(query, region = 'id') {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${region}&media=music&entity=song&limit=20`;
        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PagaskaMusic/3.2.0)' },
        });

        if (!data?.results?.length) throw new Error('Tidak ada hasil dari iTunes API');

        const results = data.results.map((r, i) => ({
            id:         String(r.trackId || `itunes_${i}`),
            title:      r.trackName   || 'Unknown',
            artist:     r.artistName  || 'Unknown',
            link:       r.trackViewUrl || `https://music.apple.com/${region}/album/${r.collectionId}?i=${r.trackId}`,
            image:      (r.artworkUrl100 || '').replace('100x100', '500x500'),
            previewUrl: r.previewUrl  || null,
            duration:   this._msToDuration(r.trackTimeMillis),
            album:      r.collectionName || '',
            year:       r.releaseDate ? new Date(r.releaseDate).getFullYear() : null,
            type:       'song',
            source:     'itunes',
        }));

        return { status: true, query, region, total: results.length, data: results };
    }

    // ── Helpers ──────────────────────────────────────────────────

    _msToDuration(ms) {
        if (!ms) return null;
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    _extractTrackId(url) {
        if (!url) return null;
        const m = url.match(/[?&]i=(\d+)/);
        return m ? m[1] : null;
    }

    // Deteksi dari prefix "Song · " / "Album · " di field artist Theresav
    _detectTypeFromArtist(artistField) {
        if (!artistField) return null;
        const lower = artistField.toLowerCase();
        if (lower.startsWith('song'))     return 'song';
        if (lower.startsWith('album'))    return 'album';
        if (lower.startsWith('artist'))   return 'artist';
        if (lower.startsWith('playlist')) return 'playlist';
        return null;
    }

    _detectTypeFromLink(url) {
        if (!url) return 'unknown';
        if (url.includes('?i=') || url.includes('/song/')) return 'song';
        if (url.includes('/album/'))    return 'album';
        if (url.includes('/artist/'))   return 'artist';
        if (url.includes('/playlist/')) return 'playlist';
        return 'unknown';
    }
}

module.exports = new AppleSearchService();
