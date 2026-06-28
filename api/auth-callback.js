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

function buildCookie(payload, secret) {
  const data    = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig     = Buffer.from(data + secret).toString('base64').slice(0, 16);
  return `${data}.${sig}`;
}

module.exports = async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = process.env.OSAMA_FRONTEND_URL || 'https://music.osama.my.id';

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

    const ip = getClientIp(req);
    const sb = getSupabase();

    const { data: user, error: upsertErr } = await sb
      .from('osama_users')
      .upsert(
        {
          email:        profile.email,
          display_name: profile.name || profile.email.split('@')[0],
          avatar_url:   profile.picture || '',
          ip_address:   ip,
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
      `osama_session=${cookieValue}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ]);

    res.redirect(`${frontendUrl}/index.html`);
  } catch (err) {
    console.error('[auth-callback]', err.message);
    const frontendUrl = process.env.OSAMA_FRONTEND_URL || 'https://music.osama.my.id';
    res.redirect(`${frontendUrl}/login.html?error=server_error`);
  }
};
