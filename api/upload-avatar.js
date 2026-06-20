// api/upload-avatar.js — Vercel Serverless Function
// Upload foto profil ke Cloudflare R2 via S3-compatible REST API
// TANPA dependency eksternal — hanya pakai Web Crypto API (built-in Node.js 18+)
//
// Env vars di Vercel Dashboard (backend repo verolyz-kingdom3):
//   R2_ENDPOINT   = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
//   R2_BUCKET_NAME     = <nama_bucket>
//   R2_ACCESS_KEY_ID = <R2_Access_Key_ID>
//   R2_SECRET_ACCESS_KEY = <R2_Secret_Access_Key>
//   R2_PUBLIC_URL = https://<domain_publik> (tanpa trailing slash)
//                   HARUS domain kustom atau *.r2.dev — BUKAN *.workers.dev

import { createHmac, createHash } from 'node:crypto';
export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
};

// ── AWS Signature V4 (pure Node.js crypto) ─────────────────

function sha256hex(data) {
  return createHash('sha256').update(data).digest('hex');
}
function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data).digest();
}
function getSigningKey(secretKey, date, region, service) {
  const kDate    = hmacSha256('AWS4' + secretKey, date);
  const kRegion  = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

async function putObjectR2({ endpoint, bucket, accessKey, secretKey, key, body, contentType }) {
  const region  = 'auto';
  const service = 's3';
  const now     = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\\.\\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStr = amzDate.slice(0, 8);

  const host        = new URL(endpoint).host;
  const url         = `${endpoint}/${bucket}/${key}`;
  const payloadHash = sha256hex(body);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${key}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credScope   = `${dateStr}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256hex(canonicalRequest)].join('\n');

  const signingKey  = getSigningKey(secretKey, dateStr, region, service);
  const signature   = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type':          contentType,
      'x-amz-date':            amzDate,
      'x-amz-content-sha256':  payloadHash,
      'Authorization':          authorization,
      'Cache-Control':          'public, max-age=31536000',
    },
    body,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`R2 PUT failed ${res.status}: ${txt.slice(0, 200)}`);
  }
}

// ── Handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mimeType, userKey } = req.body || {};

  if (!imageBase64 || !mimeType || !userKey) {
    return res.status(400).json({ error: 'imageBase64, mimeType, userKey wajib diisi' });
  }
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(mimeType)) {
    return res.status(400).json({ error: 'Format harus jpg, png, atau webp' });
  }
  if (imageBase64.length > 3_000_000) {
    return res.status(400).json({ error: 'Foto terlalu besar, maksimal ~2MB' });
  }

  const R2_ENDPOINT   = process.env.R2_ENDPOINT;
  const R2_BUCKET     = process.env.R2_BUCKET_NAME;
  const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
  const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
  const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

  // Validasi env vars lengkap
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_PUBLIC_URL) {
    const missing = ['R2_ENDPOINT','R2_BUCKET_NAME','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_PUBLIC_URL']
      .filter(k => !process.env[k]);
    return res.status(500).json({ error: 'Env var tidak lengkap', missing });
  }

  // ── BUG FIX: Tolak jika R2_PUBLIC_URL masih mengarah ke Cloudflare Worker (workers.dev)
  // R2_PUBLIC_URL harus berupa domain publik R2 kustom atau *.r2.dev — bukan *.workers.dev
  if (R2_PUBLIC_URL.includes('workers.dev')) {
    return res.status(500).json({
      error: 'R2_PUBLIC_URL salah konfigurasi — mengarah ke Cloudflare Worker (workers.dev). ' +
             'Ganti dengan domain publik R2 kamu di Vercel Dashboard. ' +
             'Contoh: https://assets.pagaska.my.id atau https://pub-xxxx.r2.dev'
    });
  }

  try {
    const buffer   = Buffer.from(imageBase64, 'base64');
    const ext      = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
    const safeKey  = userKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const filename = `avatars/${safeKey}_${Date.now()}.${ext}`;

    await putObjectR2({
      endpoint:    R2_ENDPOINT,
      bucket:      R2_BUCKET,
      accessKey:   R2_ACCESS_KEY,
      secretKey:   R2_SECRET_KEY,
      key:         filename,
      body:        buffer,
      contentType: mimeType,
    });

    const publicUrl = `${R2_PUBLIC_URL}/${filename}`;
    return res.status(200).json({ url: publicUrl });

  } catch (err) {
    console.error('[upload-avatar]', err);
    return res.status(500).json({ error: 'Gagal upload ke R2', detail: err.message });
  }
}
