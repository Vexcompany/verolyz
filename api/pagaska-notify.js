'use strict';

// api/pagaska-notify.js
// Proxy pengiriman notifikasi Telegram untuk Pagaska Music login/register.
// Bot token & chat ID disimpan di env Vercel — tidak pernah expose ke browser.

const ALLOWED_ORIGINS = [
  'https://music.pagaska.my.id',
  'https://pagaska.my.id',
  'http://localhost',
  'http://127.0.0.1',
  // Tambahkan domain lain kalau perlu
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const BOT_TOKEN = process.env.TG_BOT_TOKEN;
  const CHAT_ID   = process.env.TG_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('[pagaska-notify] TG_BOT_TOKEN atau TG_CHAT_ID belum diset di env');
    // Kembalikan 200 biar frontend tidak error — notif gagal silent di server
    return res.status(200).json({ ok: false, reason: 'not_configured' });
  }

  const { type, nama, jabatan, generasi, device, waktu } = req.body || {};

  if (!type || !nama) {
    return res.status(400).json({ error: 'type dan nama wajib diisi' });
  }

  // Buat teks pesan sesuai tipe event
  let teks;
  if (type === 'login') {
    teks = [
      `🔑 <b>LOGIN BERHASIL</b>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `👤 <b>Nama:</b> ${nama}`,
      `🏷️ <b>Jabatan:</b> ${jabatan || '-'}`,
      `📋 <b>Generasi:</b> ${generasi || '-'}`,
      `📅 <b>Waktu:</b> ${waktu || '-'}`,
      `🔑 <b>Device:</b> <code>${device || '-'}</code>`,
      ``,
      `✅ <i>Anggota berhasil masuk ke Pagaska Music.</i>`,
    ].join('\n');
  } else if (type === 'register') {
    teks = [
      `📝 <b>PENDAFTARAN BARU</b>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `👤 <b>Nama:</b> ${nama}`,
      `🏷️ <b>Jabatan:</b> ${jabatan || '-'}`,
      `📋 <b>Generasi:</b> ${generasi || '-'}`,
      `📅 <b>Waktu:</b> ${waktu || '-'}`,
      `🔑 <b>Device FP:</b> <code>${device || '-'}</code>`,
      ``,
      `⚠️ <i>Akun baru menunggu verifikasi admin.</i>`,
    ].join('\n');
  } else {
    return res.status(400).json({ error: 'type tidak dikenal' });
  }

  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id: CHAT_ID, text: teks, parse_mode: 'HTML' }),
      }
    );
    const tgData = await tgRes.json();
    return res.status(200).json({ ok: tgData.ok });
  } catch (err) {
    console.error('[pagaska-notify] Gagal kirim ke Telegram:', err.message);
    return res.status(200).json({ ok: false, reason: 'fetch_error' });
  }
};
