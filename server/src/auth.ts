import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import type { Store, User } from './db/types.js';
import { HttpError, PEOPLE, fail, id, parse, pick, route, sha256 } from './util.js';

const DUMMY_HASH = bcrypt.hashSync(id(), 11);

export type AuthedUser = { id: string; name: string; color: string; email: string };
declare module 'express-serve-static-core' { interface Request { user?: AuthedUser } }

export const publicUser = (u: User) => ({ id: u._id, name: u.name, email: u.email, color: u.color });

const password = z.string().min(8, 'Use at least 8 characters for your password.').max(200, 'That password is too long.');
const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(200);
const name = z.string().trim().min(1, 'Enter your name.').max(60, 'Keep your name under 60 characters.');

export function signAccess(u: AuthedUser) {
  return jwt.sign({ name: u.name, color: u.color, email: u.email }, config.jwtSecret, { subject: u.id, expiresIn: config.accessTtlSec, algorithm: 'HS256' });
}

export function verifyAccess(token: string): AuthedUser | null {
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    return { id: p.sub!, name: p.name, color: p.color, email: p.email };
  } catch { return null; }
}

/** Reads the bearer token if there is one. Routes decide whether a user is required. */
export function readUser(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) req.user = verifyAccess(h.slice(7)) ?? undefined;
  next();
}
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.', 'signed_out'));
  next();
}

export function authRoutes(db: Store) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Wait a few minutes and try again.', code: 'rate_limited' } });

  async function issue(u: User) {
    const refresh = id(32);
    await db.sessions.insert({ _id: sha256(refresh), userId: u._id, createdAt: new Date(), expiresAt: new Date(Date.now() + config.refreshTtlDays * 864e5) });
    const pu = publicUser(u);
    return { user: pu, accessToken: signAccess(pu), refreshToken: refresh, expiresIn: config.accessTtlSec };
  }

  r.post('/signup', limiter, route(async (req, res) => {
    const body = parse(z.object({ name, email, password }), req.body);
    if (await db.users.byEmail(body.email)) fail(409, 'That email already has an account. Sign in instead.', 'exists');
    const u: User = { _id: id(), email: body.email, name: body.name, passwordHash: await bcrypt.hash(body.password, 11), color: pick(PEOPLE), createdAt: new Date() };
    try { await db.users.insert(u); } catch (e) {
      if ((e as { code?: number }).code === 11000) fail(409, 'That email already has an account. Sign in instead.', 'exists');
      throw e;
    }
    res.status(201).json(await issue(u));
  }));

  r.post('/login', limiter, route(async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1, 'Enter your password.') }), req.body);
    const u = await db.users.byEmail(body.email);
    // compare against a dummy hash when the email is unknown so timing does not reveal which emails exist
    const ok = await bcrypt.compare(body.password, u?.passwordHash || DUMMY_HASH);
    if (!u || !ok) fail(401, 'Wrong email or password.', 'bad_login');
    res.json(await issue(u!));
  }));

  r.post('/refresh', route(async (req, res) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
    const s = await db.sessions.get(sha256(refreshToken));
    if (!s) fail(401, 'Your session ended. Sign in again.', 'session_ended');
    await db.sessions.delete(s!._id); // rotate: every refresh token works once
    const u = await db.users.byId(s!.userId);
    if (!u) fail(401, 'Your session ended. Sign in again.', 'session_ended');
    res.json(await issue(u!));
  }));

  r.post('/logout', route(async (req, res) => {
    const t = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
    if (t) await db.sessions.delete(sha256(t));
    res.json({ ok: true });
  }));

  r.get('/me', requireUser, route(async (req, res) => {
    const u = await db.users.byId(req.user!.id);
    if (!u) fail(401, 'Your session ended. Sign in again.', 'session_ended');
    res.json({ user: publicUser(u!) });
  }));

  r.patch('/me', requireUser, route(async (req, res) => {
    const body = parse(z.object({ name: name.optional(), color: z.enum(PEOPLE as [string, ...string[]]).optional() }), req.body);
    await db.users.update(req.user!.id, body);
    const u = (await db.users.byId(req.user!.id))!;
    const pu = publicUser(u);
    res.json({ user: pu, accessToken: signAccess(pu) });
  }));

  return r;
}
