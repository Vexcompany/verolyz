'use strict';

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

module.exports = (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Atribut cookie saat clear HARUS persis sama (SameSite=None; Secure)
  // dengan saat di-set, kalau tidak browser tidak akan menghapusnya.
  res.setHeader('Set-Cookie', [
    'osama_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None',
  ]);

  const frontendUrl = process.env.OSAMA_FRONTEND_URL || 'https://music.osama.my.id';

  if (req.query.redirect === '0') {
    return res.json({ ok: true });
  }

  res.redirect(`${frontendUrl}/login.html`);
};
