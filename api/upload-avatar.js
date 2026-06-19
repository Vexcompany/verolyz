// api/upload-avatar.js — Vercel Serverless Function
// Upload foto profil user ke Cloudflare R2
// Env vars yang dibutuhkan di Vercel Dashboard (verolyz-main):
//   R2_ENDPOINT   = https://<account_id>.r2.cloudflarestorage.com
//   R2_BUCKET     = <nama_bucket_kamu>
//   R2_ACCESS_KEY = <access_key_id>
//   R2_SECRET_KEY = <secret_access_key>
//   R2_PUBLIC_URL = https://<custom_domain_atau_r2_dev_url>  (tanpa trailing slash)

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const config = {
  api: { bodyParser: { sizeLimit: '3mb' } }
};

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, mimeType, userKey } = req.body || {};

  if (!imageBase64 || !mimeType || !userKey) {
    return res.status(400).json({ error: 'imageBase64, mimeType, dan userKey wajib diisi' });
  }

  // Validasi mime type
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(mimeType)) {
    return res.status(400).json({ error: 'Format harus jpg, png, atau webp' });
  }

  // Validasi ukuran base64 (max ~2MB decoded)
  if (imageBase64.length > 2_800_000) {
    return res.status(400).json({ error: 'Ukuran foto maksimal 2MB' });
  }

  try {
    const buffer   = Buffer.from(imageBase64, 'base64');
    const ext      = mimeType.split('/')[1].replace('jpeg', 'jpg');
    // Slug user_key jadi aman untuk filename
    const safeKey  = userKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const filename = `avatars/${safeKey}_${Date.now()}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket:      process.env.R2_BUCKET,
      Key:         filename,
      Body:        buffer,
      ContentType: mimeType,
      // Cache 1 tahun — avatar jarang berubah
      CacheControl: 'public, max-age=31536000',
    }));

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${filename}`;
    return res.status(200).json({ url: publicUrl });

  } catch (err) {
    console.error('[upload-avatar]', err);
    return res.status(500).json({ error: 'Gagal upload ke R2', detail: err.message });
  }
}
