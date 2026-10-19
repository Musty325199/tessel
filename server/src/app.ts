import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import type { Store } from './db/types.js';
import { authRoutes, readUser, requireUser } from './auth.js';
import { boardRoutes } from './boards.js';
import { Rooms } from './realtime.js';
import { config } from './config.js';
import { errorHandler, parse, route } from './util.js';

export function createApp(db: Store) {
  const app = express();
  const rooms = new Rooms(db);
  app.set('trust proxy', 1); // Render sits behind a proxy; needed for per-IP rate limits
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.origins, credentials: false, maxAge: 86400 }));
  app.use(express.json({ limit: '1mb' }));
  app.use(readUser);

  app.get('/', (_req, res) => { res.json({ name: 'Tessel API', ok: true, docs: '/api/docs' }); });
  app.get('/health', (_req, res) => { res.json({ ok: true, uptime: Math.round(process.uptime()) }); });

  app.use('/api/auth', authRoutes(db));
  app.use('/api', boardRoutes(db, rooms));

  app.get('/api/notifications', requireUser, route(async (req, res) => {
    const list = await db.notifications.list(req.user!.id, 50);
    const people = new Map((await db.users.byIds([...new Set(list.map((n) => n.fromUserId))])).map((u) => [u._id, u]));
    res.json({
      notifications: list.map((n) => ({ id: n._id, kind: n.kind, boardId: n.boardId, text: n.text, read: n.read, createdAt: n.createdAt, from: people.get(n.fromUserId) ? { name: people.get(n.fromUserId)!.name, color: people.get(n.fromUserId)!.color } : null })),
      unread: list.filter((n) => !n.read).length,
    });
  }));
  app.post('/api/notifications/read', requireUser, route(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.string().max(40)).max(100).optional() }), req.body ?? {});
    await db.notifications.markRead(req.user!.id, ids);
    res.json({ ok: true });
  }));

  app.use((_req, res) => { res.status(404).json({ error: 'Not found.', code: 'not_found' }); });
  app.use(errorHandler);
  return { app, rooms };
}
