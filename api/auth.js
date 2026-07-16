'use strict';

/**
 * api/auth.js — Gabungan semua auth endpoints (Vercel Serverless)
 *
 * Routes yang ditangani:
 *   GET  /api/auth/google       → redirect ke Google OAuth
 *   GET  /api/auth/callback     → handle OAuth callback dari Google
 *   GET  /api/auth/check-ip     → cek session (backward compat)
 *   GET  /api/auth/me           → get user info + device token
 *   GET  /api/auth/logout       → clear session cookie
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// ── Supabase ──────────────────────────────────────────────────
function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

// ── Session helpers ───────────────────────────────────────────
function buildCookie(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig  = Buffer.from(data + (secret || 'osama-secret')).toString('base64').slice(0, 16);
  return `${data}.${sig}`;
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

// ── Device token helpers ──────────────────────────────────────
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
  for (let d = 0; d <= 30; d++) {
    const payload  = `${userId}:${fingerprint}:${today - d}`;
    const expected = crypto.createHmac('sha256', s).update(payload).digest('hex');
    try {
      if (crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) return true;
    } catch { /* panjang berbeda = invalid */ }
  }
  return false;
}

// ── CORS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://music.osama.my.id',
  'https://osama.my.id',
  'http://localhost:3000',
];

function applyCors(req, res, methods = 'GET, OPTIONS') {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-device-token');
  res.setHeader('Vary', 'Origin');
}

// ── Sub-handlers ──────────────────────────────────────────────

async function handleGoogle(req, res) {
  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: 'Google OAuth not configured' });
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

async function handleCallback(req, res) {
  const frontendUrl = process.env.OSAMA_FRONTEND_URL || 'https://music.osama.my.id';
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(`${frontendUrl}/login.html?error=oauth_denied`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token from Google');

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profile.email) throw new Error('Could not fetch Google profile');

    const sb = getSupabase();
    const { data: user, error: upsertErr } = await sb
      .from('osama_users')
      .upsert(
        {
          email:        profile.email,
          display_name: profile.name || profile.email.split('@')[0],
          avatar_url:   profile.picture || '',
          updated_at:   new Date().toISOString(),
        },
        { onConflict: 'email', returning: 'representation' }
      )
      .select()
      .single();

    if (upsertErr) throw upsertErr;

    const sessionPayload = {
      id:           user.id,
      email:        user.email,
      display_name: user.display_name,
      avatar_url:   user.avatar_url,
      iat:          Date.now(),
    };

    const cookieValue = buildCookie(sessionPayload, process.env.SESSION_SECRET || 'osama-secret');
    const maxAge      = 60 * 60 * 24 * 30;

    res.setHeader('Set-Cookie', [
      `osama_session=${cookieValue}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=None`,
    ]);

    const fingerprint = getDeviceFingerprint(req);
    const deviceToken = signDeviceToken(user.id, fingerprint, process.env.SESSION_SECRET);

    return res.redirect(`${frontendUrl}/index.html?dt=${deviceToken}`);
  } catch (err) {
    console.error('[auth-callback]', err.message);
    return res.redirect(`${frontendUrl}/login.html?error=server_error`);
  }
}

async function handleCheckIp(req, res) {
  // Hanya cek cookie — IP login sudah dihapus
  const session = parseSession(req.headers.cookie, process.env.SESSION_SECRET);
  if (session) {
    return res.json({ ok: true, source: 'cookie' });
  }
  return res.json({ ok: false, reason: 'no_session' });
}

async function handleMe(req, res) {
  const session = parseSession(req.headers.cookie, process.env.SESSION_SECRET);
  if (!session) {
    return res.status(401).json({ ok: false, reason: 'not_authenticated' });
  }

  const deviceToken = req.headers['x-device-token'] || '';
  const fingerprint = getDeviceFingerprint(req);

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

    const newDeviceToken = signDeviceToken(session.id, fingerprint, process.env.SESSION_SECRET);
    return res.json({ ok: true, user, device_token: newDeviceToken });
  } catch (err) {
    console.error('[auth-me]', err.message);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

function handleLogout(req, res) {
  res.setHeader('Set-Cookie', [
    'osama_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None',
  ]);

  const frontendUrl = process.env.OSAMA_FRONTEND_URL || 'https://music.osama.my.id';

  if (req.query.redirect === '0') {
    return res.json({ ok: true });
  }

  res.redirect(`${frontendUrl}/login.html`);
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async (req, res) => {
  // Routing berdasarkan path
  const path = req.url.split('?')[0];

  // Callback tidak butuh CORS (redirect dari Google)
  if (path === '/api/auth/callback') {
    return handleCallback(req, res);
  }

  // Google redirect juga tidak butuh CORS
  if (path === '/api/auth/google') {
    return handleGoogle(req, res);
  }

  // Semua endpoint lain butuh CORS
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (path === '/api/auth/check-ip') {
    return handleCheckIp(req, res);
  }

  if (path === '/api/auth/me') {
    return handleMe(req, res);
  }

  if (path === '/api/auth/logout') {
    return handleLogout(req, res);
  }

  return res.status(404).json({ error: 'Auth endpoint not found', path });
};
