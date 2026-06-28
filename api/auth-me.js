'use strict';

const { createClient } = require('@supabase/supabase-js');

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

module.exports = async (req, res) => {
  const session = parseSession(req.headers.cookie, process.env.SESSION_SECRET);
  if (!session) {
    return res.status(401).json({ ok: false, reason: 'not_authenticated' });
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

    return res.json({ ok: true, user });
  } catch (err) {
    console.error('[auth-me]', err.message);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
};
