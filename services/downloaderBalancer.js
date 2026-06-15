// services/downloaderBalancer.js
// Round-robin load balancer untuk Nexray & Theresav.
// Strategi:
//   - Dua slot (nexray, theresav) dipilih bergantian per request.
//   - Jika dua request masuk hampir bersamaan, request kedua otomatis
//     dapat slot yang berbeda dari request pertama (atomic counter).
//   - Satu retry di API yang sama sebelum fallback ke API satunya.
//   - Jika kedua API gagal → throw error agar caller bisa pakai previewUrl.

const axios = require('axios');

// ── Config API ────────────────────────────────────────────────────────────────
const APIS = {
  nexray: {
    name: 'Nexray',
    timeout: 65000,
    call: async (appleUrl) => {
      const res = await axios.get('https://api.nexray.eu.cc/downloader/applemusic', {
        params:  { url: appleUrl },
        timeout: 65000,
        headers: { 'User-Agent': 'PagaskaMusic/3.2.0' },
      });
      const body = res.data;
      if (!body?.status) throw new Error(body?.message || 'Nexray: request gagal');
      const r = body.result || {};
      if (!r.url) throw new Error('Nexray: tidak ada URL audio di response');
      return {
        mp3:       r.url,
        title:     r.name      || null,
        artist:    r.artist    || null,
        thumbnail: r.thumbnail || null,
        duration:  r.duration  || null,
      };
    },
  },

  theresav: {
    name: 'Theresav',
    timeout: 65000,
    call: async (appleUrl) => {
      // Theresav: GET dengan query param url + apikey
      const apikey = process.env.THERESAV_API_KEY;
      if (!apikey) throw new Error('THERESAV_API_KEY env var tidak di-set di Vercel');
      const res = await axios.get('https://api.theresav.biz.id/download/applemusic', {
        params:  { url: appleUrl, apikey },
        timeout: 65000,
        headers: { 'User-Agent': 'PagaskaMusic/3.2.0' },
      });
      const body = res.data;
      if (!body?.status) throw new Error(body?.message || 'Theresav: request gagal');
      const r = body.result || {};
      const mp3 = r?.download?.url || r?.url || null;
      if (!mp3) throw new Error('Theresav: tidak ada URL audio di response');
      return {
        mp3,
        title:     r?.metadata?.title     || r?.name      || null,
        artist:    r?.metadata?.artist    || r?.artist    || null,
        thumbnail: r?.metadata?.thumbnail || r?.thumbnail || null,
        duration:  r?.metadata?.duration  || r?.duration  || null,
      };
    },
  },
};

const API_KEYS = Object.keys(APIS); // ['nexray', 'theresav']

// ── Round-robin counter (in-memory, reset saat cold start) ────────────────────
// Vercel: tiap serverless instance punya counter sendiri — tidak masalah.
// Tujuannya bukan distributed fairness, tapi menghindari 2 request
// bersamaan di instance yang sama menekan satu API.
let _counter = 0;

/**
 * Pilih slot API berikutnya secara atomic (pre-increment).
 * Mengembalikan index 0 atau 1 dari API_KEYS.
 */
function _nextSlot() {
  // Bungkus agar tidak overflow ke bilangan negatif setelah ~2 miliar request
  _counter = (_counter + 1) % 1000000;
  return _counter % API_KEYS.length;
}

// ── Downloader Balancer ───────────────────────────────────────────────────────

class DownloaderBalancer {
  /**
   * Download Apple Music track dengan load balancing.
   * Retry 1x di API primer, lalu fallback ke API satunya.
   *
   * @param {string} appleUrl - Apple Music track URL
   * @returns {Promise<{ mp3, title, artist, thumbnail, duration }>}
   */
  async download(appleUrl) {
    if (!appleUrl) throw new Error('appleUrl diperlukan');

    const slot      = _nextSlot();
    const primaryKey   = API_KEYS[slot];
    const fallbackKey  = API_KEYS[1 - slot]; // kalau slot=0 → fallback=1, dst

    const primary  = APIS[primaryKey];
    const fallback = APIS[fallbackKey];

    // ── 1. Coba API primer ───────────────────────────────────────────────────
    console.log(`[balancer] Slot #${_counter % API_KEYS.length} → primer: ${primary.name}`);

    let lastError;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await primary.call(appleUrl);
        console.log(`[balancer] ✅ ${primary.name} berhasil (attempt ${attempt})`);
        return result;
      } catch (err) {
        lastError = err;
        console.warn(`[balancer] ${primary.name} gagal (attempt ${attempt}): ${err.message}`);
        if (attempt < 2) {
          // Tunggu sebentar sebelum retry (exponential: 1.5 detik)
          await _sleep(1500);
        }
      }
    }

    // ── 2. Fallback ke API satunya ───────────────────────────────────────────
    console.log(`[balancer] Fallback ke ${fallback.name}...`);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await fallback.call(appleUrl);
        console.log(`[balancer] ✅ ${fallback.name} berhasil (attempt ${attempt}, fallback)`);
        return result;
      } catch (err) {
        lastError = err;
        console.warn(`[balancer] ${fallback.name} gagal (attempt ${attempt}): ${err.message}`);
        if (attempt < 2) {
          await _sleep(1500);
        }
      }
    }

    // ── 3. Kedua API gagal ───────────────────────────────────────────────────
    throw new Error(
      `Semua downloader gagal. Error terakhir: ${lastError?.message || 'unknown'}. ` +
      'Coba lagi atau gunakan lagu lain.'
    );
  }

  /**
   * Status slot saat ini (untuk logging/monitoring).
   */
  getStatus() {
    return {
      counter:     _counter,
      nextPrimary: API_KEYS[(_counter + 1) % API_KEYS.length],
      apis: API_KEYS.map(k => ({ name: APIS[k].name, key: k })),
    };
  }
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = new DownloaderBalancer();
