import { Router } from 'express';
import { createHash } from 'node:crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireUser } from './auth.js';
import { fail, route } from './util.js';

/** Reads cloudinary://API_KEY:API_SECRET@CLOUD_NAME, the value Cloudinary shows as "API environment variable". */
export function cloudinaryConfig(url = process.env.CLOUDINARY_URL || '') {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)/.exec(url.trim());
  return m ? { apiKey: m[1], secret: m[2], cloud: m[3] } : null;
}

/** Cloudinary signs the sorted parameters joined with &, followed by the secret, using SHA-1. */
export function sign(params: Record<string, string | number>, secret: string) {
  const s = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return createHash('sha1').update(s + secret).digest('hex');
}

/**
 * The browser uploads straight to Cloudinary, so photos never pass through (or slow down) our server.
 * The server only signs each upload, and the secret never leaves it.
 */
export function uploadRoutes() {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 120, keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip || ''), message: { error: 'Too many uploads in a short time. Try again later.', code: 'rate_limited' } });
  r.get('/uploads/status', (_req, res) => { res.json({ enabled: !!cloudinaryConfig() }); });
  r.post('/uploads/sign', requireUser, limiter, route(async (req, res) => {
    const c = cloudinaryConfig();
    if (!c) fail(503, 'Photo uploads aren’t set up on this server.', 'uploads_off');
    const params = { folder: `tessel/${req.user!.id}`, timestamp: Math.floor(Date.now() / 1000) };
    res.json({ cloud: c!.cloud, apiKey: c!.apiKey, ...params, signature: sign(params, c!.secret) });
  }));
  return r;
}
