'use strict';

module.exports = (req, res) => {
  res.setHeader('Set-Cookie', [
    'osama_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
  ]);

  const frontendUrl = process.env.OSAMA_FRONTEND_URL || 'https://music.osama.my.id';

  if (req.query.redirect === '0') {
    return res.json({ ok: true });
  }

  res.redirect(`${frontendUrl}/login.html`);
};
