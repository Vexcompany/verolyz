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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

  const sb = getSupabase();

  if (req.method === 'GET') {
    try {
      const { data, error } = await sb
        .from('osama_users')
        .select('liked_songs, queue, last_track, updated_at')
        .eq('id', session.id)
        .single();

      if (error) throw error;
      return res.json({ ok: true, ...data });
    } catch (err) {
      return res.status(500).json({ ok: false, reason: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const allowed = ['liked_songs', 'queue', 'last_track'];
    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ ok: false, reason: 'no_valid_fields' });
    }

    updates.updated_at = new Date().toISOString();

    try {
      const { error } = await sb
        .from('osama_users')
        .update(updates)
        .eq('id', session.id);

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, reason: err.message });
    }
  }

  res.status(405).json({ ok: false, reason: 'method_not_allowed' });
};
