// middleware/cors.js — Vercel-ready

const corsMiddleware = (req, res, next) => {
    const allowedOrigins = [
        // Production
        'https://music.pagaska.my.id',
        'http://music.pagaska.my.id',
        // Vercel frontend deployment (adjust project name if needed)
        'https://pagaska-music-frontend.vercel.app',
        // Local dev
        'http://localhost:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
    ];

    const origin = req.headers.origin;

    // Allow exact matches OR any *.vercel.app preview URL for the frontend
    const isAllowed = !origin
        || allowedOrigins.includes(origin)
        || /^https:\/\/pagaska-music-frontend(-[a-z0-9]+)?\.vercel\.app$/.test(origin);

    res.setHeader('Access-Control-Allow-Origin', isAllowed ? (origin || '*') : allowedOrigins[0]);

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
