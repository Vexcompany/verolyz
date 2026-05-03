// middleware/cors.js

const corsMiddleware = (req, res, next) => {
    const allowedOrigins = [
        'https://music.pagaska.my.id',
        'http://music.pagaska.my.id',
        'http://localhost:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
    ];

    const origin = req.headers.origin;

    if (!origin || allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else {
        // Kalau mau buka ke semua origin (lebih mudah saat dev), pakai ini:
        res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
};

module.exports = corsMiddleware;
