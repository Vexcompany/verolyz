'use strict';

// Endpoint ini sekarang TIDAK lagi pakai IP-based login.
// IP login dihapus karena bisa bocor saat user berbeda share WiFi yang sama.
// Endpoint ini tetap ada untuk backward compat, tapi hanya cek cookie session.
// Login otomatis sekarang lewat device token (x-device-token header) di /api/auth/me.

const ALLOWED_ORIGINS = [
  'https://music.osama.my.id',
  'https://osama.my.id',
  'http://localhost:3000',
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function parseSession(cookieHeader, secret) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/osama_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data, sig] = match[1].split('.');
    const expectedSig = Buffer.from(data + (secret || 'osama-secret')).toString('base64').slice(0, 16);
    if (sig !== expectedSig) return null;
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Hanya cek cookie — tidak ada IP lookup lagi
  const session = parseSession(req.headers.cookie, process.env.SESSION_SECRET);
  if (session) {
    return res.json({ ok: true, source: 'cookie' });
  }

  return res.json({ ok: false, reason: 'no_session' });
};
