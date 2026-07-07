'use strict';

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
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

function getDeviceFingerprint(req) {
  const ua   = req.headers['user-agent'] || '';
  const lang = req.headers['accept-language'] || '';
  return crypto.createHash('sha1').update(ua + lang).digest('hex').slice(0, 16);
}

function signDeviceToken(userId, fingerprint, secret) {
  const day     = Math.floor(Date.now() / 86400000);
  const payload = `${userId}:${fingerprint}:${day}`;
  return crypto.createHmac('sha256', secret || 'osama-dt-secret').update(payload).digest('hex');
}

function verifyDeviceToken(token, userId, fingerprint, secret) {
  if (!token || token.length !== 64) return false;
  const today = Math.floor(Date.now() / 86400000);
  const s     = secret || 'osama-dt-secret';
  // Toleransi 30 hari ke belakang
  for (let d = 0; d <= 30; d++) {
    const payload  = `${userId}:${fingerprint}:${today - d}`;
    const expected = crypto.createHmac('sha256', s).update(payload).digest('hex');
    try {
      if (crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) return true;
    } catch { /* panjang berbeda = invalid */ }
  }
  return false;
}

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-device-token');
  res.setHeader('Vary', 'Origin');
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const session = parseSession(req.headers.cookie, process.env.SESSION_SECRET);
  if (!session) {
    return res.status(401).json({ ok: false, reason: 'not_authenticated' });
  }

  // Device token check — kalau ada token dikirim, harus cocok dengan fingerprint device ini
  const deviceToken  = req.headers['x-device-token'] || '';
  const fingerprint  = getDeviceFingerprint(req);

  if (deviceToken) {
    const valid = verifyDeviceToken(deviceToken, session.id, fingerprint, process.env.SESSION_SECRET);
    if (!valid) {
      return res.status(401).json({ ok: false, reason: 'device_mismatch' });
    }
  }

  try {
    const sb = getSupabase();
    const { data: user, error } = await sb
      .from('osama_users')
      .select('id, email, display_name, avatar_url, liked_songs, queue, last_track, updated_at')
      .eq('id', session.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ ok: false, reason: 'user_not_found' });
    }

    // Return fresh device token (rotated tiap hari)
    const newDeviceToken = signDeviceToken(session.id, fingerprint, process.env.SESSION_SECRET);

    return res.json({ ok: true, user, device_token: newDeviceToken });
  } catch (err) {
    console.error('[auth-me]', err.message);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
};
