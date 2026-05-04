// middleware/cors.js — Vercel-ready (FIXED)

const corsMiddleware = (req, res, next) => {
    // Izinkan semua origin agar tidak ada masalah CORS dari domain manapun
    // Ganti '*' dengan domain spesifik jika ingin lebih ketat
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    // Catatan: Access-Control-Allow-Credentials tidak bisa dipakai bersamaan dengan '*'
    // Hapus baris di bawah jika tidak butuh credentials (cookie/auth header)
    // res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle preflight request — WAJIB return 200/204 sebelum ke route
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    next();
};

module.exports = corsMiddleware;
