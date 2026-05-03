// services/appleSearch.js — v2
// Tambah previewUrl dari iTunes agar download tidak perlu scraping aplmate

const axios = require('axios');
const cheerio = require('cheerio');

class AppleSearchService {

    async search(query, region = 'id') {
        try {
            const scrapeResult = await this.searchByScraping(query, region);
            if (scrapeResult && scrapeResult.length > 0) {
                return { status: true, query, region, total: scrapeResult.length, data: scrapeResult };
            }
        } catch (err) {
            console.warn('[appleSearch] Scraping gagal, fallback ke iTunes API:', err.message);
        }
        return await this.searchByITunes(query, region);
    }

    async searchByScraping(query, region = 'id') {
        const url = `https://music.apple.com/${region}/search?term=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            }
        });

        const $ = cheerio.load(data);
        const results = [];
        $(".top-search-lockup, .shelf-grid__item, .track-lockup").each((i, el) => {
            const title  = $(el).find(".top-search-lockup__primary__title, .product-lockup__title, .track-lockup__title").text().trim();
            const artist = $(el).find(".top-search-lockup__secondary, .product-lockup__subtitle, .track-lockup__subtitle").text().trim();
            const link   = $(el).find("a.click-action, a.product-lockup__link, a.track-lockup__link").attr("href");
            let image = $(el).find("picture source[type='image/webp']").attr("srcset")?.split(" ")[0]
                     || $(el).find("img").attr("src")
                     || $(el).find("source").attr("srcset")?.split(" ")[0];
            const trackId = this.extractTrackId(link);
            if (title && artist && link) {
                results.push({
                    id: trackId || `track_${i}`,
                    title,
                    artist: artist.replace(/^Song\s*[·•]\s*/, '').replace(/^Artist\s*[·•]\s*/, ''),
                    link: link.startsWith("http") ? link : `https://music.apple.com${link}`,
                    image: image || null,
                    previewUrl: null, // scraping tidak dapat previewUrl
                    type: this.detectType(link),
                    source: 'scrape'
                });
            }
        });
        return results.slice(0, 20);
    }

    async searchByITunes(query, region = 'id') {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${region}&media=music&entity=song&limit=20`;
        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; ZemzBot/1.0)" }
        });

        if (!data?.results?.length) throw new Error('Tidak ada hasil dari iTunes API');

        const results = data.results.map((r, i) => ({
            id:         String(r.trackId || `itunes_${i}`),
            title:      r.trackName   || 'Unknown',
            artist:     r.artistName  || 'Unknown',
            link:       r.trackViewUrl || `https://music.apple.com/${region}/album/${r.collectionId}?i=${r.trackId}`,
            image:      (r.artworkUrl100 || '').replace('100x100', '500x500'),
            // ★ KUNCI: simpan previewUrl agar download tidak perlu scraping
            previewUrl: r.previewUrl  || null,
            duration:   this.msToDuration(r.trackTimeMillis),
            album:      r.collectionName || '',
            year:       r.releaseDate ? new Date(r.releaseDate).getFullYear() : null,
            type:       'song',
            source:     'itunes'
        }));

        return { status: true, query, region, total: results.length, data: results };
    }

    msToDuration(ms) {
        if (!ms) return '0:00';
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    extractTrackId(url) {
        if (!url) return null;
        const m = url.match(/[?&]i=(\d+)/);
        return m ? m[1] : null;
    }
    detectType(url) {
        if (!url) return 'unknown';
        if (url.includes('/album/'))    return 'album';
        if (url.includes('/song/')   || url.includes('?i=')) return 'song';
        if (url.includes('/artist/'))   return 'artist';
        if (url.includes('/playlist/')) return 'playlist';
        return 'unknown';
    }
}

module.exports = new AppleSearchService();
