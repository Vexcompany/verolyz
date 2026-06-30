'use strict';

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || req.connection?.remoteAddress || '';
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

function buildCookie(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig  = Buffer.from(data + (secret || 'osama-secret')).toString('base64').slice(0, 16);
  return `${data}.${sig}`;
}

// Daftar origin frontend yang boleh akses endpoint ini dengan cookie.
// PENTING: saat credentials/cookie dipakai, header ini WAJIB diisi origin
// spesifik (bukan '*'), kalau tidak browser akan menolak responsenya.
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

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const session = parseSession(req.headers.cookie, process.env.SESSION_SECRET);
  if (session) {
    return res.json({ ok: true, source: 'cookie', user: session });
  }

  const ip = getClientIp(req);
  if (!ip || ip === '::1' || ip === '127.0.0.1') {
    return res.json({ ok: false, reason: 'local_ip' });
  }

  try {
    const sb = getSupabase();
    const { data: user, error } = await sb
      .from('osama_users')
      .select('id, email, display_name, avatar_url')
      .eq('ip_address', ip)
      .single();

    if (error || !user) {
      return res.json({ ok: false, reason: 'no_match' });
    }

    const sessionPayload = {
      id:           user.id,
      email:        user.email,
      display_name: user.display_name,
      avatar_url:   user.avatar_url,
      iat:          Date.now(),
    };

    const cookieValue = buildCookie(sessionPayload, process.env.SESSION_SECRET);
    const maxAge      = 60 * 60 * 24 * 30;

    // SameSite=None + Secure WAJIB karena cookie ini dipakai lintas-domain
    // (backend di vercel.app, frontend di music.osama.my.id).
    res.setHeader('Set-Cookie', [
      `osama_session=${cookieValue}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=None`,
    ]);

    return res.json({ ok: true, source: 'ip', user: sessionPayload });
  } catch (err) {
    console.error('[auth-check-ip]', err.message);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
};
