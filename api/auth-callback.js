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

function buildCookie(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig  = Buffer.from(data + (secret || 'osama-secret')).toString('base64').slice(0, 16);
  return `${data}.${sig}`;
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

module.exports = async (req, res) => {
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

    // Generate device token dan pass via query param ke frontend
    // (tidak bisa lewat header karena ini redirect)
    const fingerprint   = getDeviceFingerprint(req);
    const deviceToken   = signDeviceToken(user.id, fingerprint, process.env.SESSION_SECRET);

    return res.redirect(`${frontendUrl}/index.html?dt=${deviceToken}`);
  } catch (err) {
    console.error('[auth-callback]', err.message);
    return res.redirect(`${frontendUrl}/login.html?error=server_error`);
  }
};
