import { Router } from 'express';
import { z } from 'zod';
import type { Board, Comment, Store, User } from './db/types.js';
import { requireUser } from './auth.js';
import { canEdit, roleFor } from './access.js';
import type { Rooms } from './realtime.js';
import { sendMail } from './mail.js';
import { config } from './config.js';
import { fail, id, parse, route } from './util.js';

const text = z.string().trim().min(1, 'Write something first.').max(2000, 'Keep comments under 2,000 characters.');
const mentions = z.array(z.string().max(40)).max(20).optional();

export function commentRoutes(db: Store, rooms: Rooms) {
  const r = Router();

  async function access(boardId: string, userId: string, k: unknown) {
    const b = await db.boards.get(boardId);
    if (!b) fail(404, 'This board doesn’t exist.', 'not_found');
    const role = roleFor(b!, userId, typeof k === 'string' ? k : null);
    if (!role) fail(403, 'You don’t have access to this board.', 'no_access');
    return { board: b!, role: role! };
  }

  const peopleOf = (b: Board) => new Set([b.ownerId, ...b.members.map((m) => m.userId)]);

  async function view(list: Comment[]) {
    const ids = new Set<string>(); list.forEach((c) => c.messages.forEach((m) => ids.add(m.userId)));
    const users = new Map((await db.users.byIds([...ids])).map((u) => [u._id, u]));
    const who = (uid: string) => { const u = users.get(uid); return u ? { id: u._id, name: u.name, color: u.color } : { id: uid, name: 'Former member', color: '#9AA5B4' }; };
    return list.map((c) => ({
      id: c._id, x: c.x, y: c.y, shapeId: c.shapeId, ox: c.ox, oy: c.oy, resolved: c.resolved, createdAt: c.createdAt, updatedAt: c.updatedAt,
      messages: c.messages.map((m) => ({ id: m.id, text: m.text, mentions: m.mentions, createdAt: m.createdAt, editedAt: m.editedAt, author: who(m.userId) })),
    }));
  }

  /** Mentioned people get a notification and an email; everyone else in the thread gets a reply notification. */
  async function tell(board: Board, c: Comment, from: { id: string; name: string }, said: string, mentioned: string[]) {
    const allowed = peopleOf(board);
    const ment = [...new Set(mentioned)].filter((u) => u !== from.id && allowed.has(u));
    const thread = [...new Set(c.messages.map((m) => m.userId))].filter((u) => u !== from.id && !ment.includes(u));
    const short = said.length > 120 ? said.slice(0, 117) + '…' : said;
    const link = `${config.appUrl}/b/${board._id}?c=${c._id}`;
    const users = new Map((await db.users.byIds([...ment, ...thread])).map((u) => [u._id, u] as [string, User]));
    for (const uid of ment) {
      await db.notifications.insert({ _id: id(), userId: uid, kind: 'mention', boardId: board._id, fromUserId: from.id, text: `${from.name} mentioned you on “${board.title}”: ${short}`, read: false, createdAt: new Date() });
      const u = users.get(uid);
      if (u) sendMail(u.email, `${from.name} mentioned you on “${board.title}”`, { text: `${from.name} wrote:\n“${short}”`, link: { href: link, label: 'Open the comment' } });
    }
    for (const uid of thread) {
      await db.notifications.insert({ _id: id(), userId: uid, kind: 'reply', boardId: board._id, fromUserId: from.id, text: `${from.name} replied on “${board.title}”: ${short}`, read: false, createdAt: new Date() });
    }
  }

  const changed = (boardId: string) => rooms.notify(boardId, { type: 'comments' });

  r.get('/boards/:id/comments', requireUser, route(async (req, res) => {
    const { board } = await access(req.params.id, req.user!.id, req.query.k);
    res.json({ comments: await view(await db.comments.list(board._id)) });
  }));

  r.post('/boards/:id/comments', requireUser, route(async (req, res) => {
    const body = parse(z.object({
      x: z.number().finite(), y: z.number().finite(),
      shapeId: z.string().max(40).nullable().optional(), ox: z.number().finite().optional(), oy: z.number().finite().optional(),
      text, mentions,
    }), req.body);
    const { board } = await access(req.params.id, req.user!.id, req.query.k);
    const now = new Date();
    const c: Comment = {
      _id: id(), boardId: board._id, x: body.x, y: body.y, shapeId: body.shapeId ?? null, ox: body.ox ?? 0, oy: body.oy ?? 0, resolved: false,
      messages: [{ id: id(8), userId: req.user!.id, text: body.text, mentions: body.mentions ?? [], createdAt: now }], createdAt: now, updatedAt: now,
    };
    await db.comments.insert(c);
    await tell(board, c, req.user!, body.text, body.mentions ?? []);
    await changed(board._id);
    res.status(201).json({ comment: (await view([c]))[0] });
  }));

  async function thread(boardId: string, cid: string) {
    const c = await db.comments.get(cid);
    if (!c || c.boardId !== boardId) fail(404, 'That comment was deleted.', 'not_found');
    return c!;
  }

  r.post('/boards/:id/comments/:cid/replies', requireUser, route(async (req, res) => {
    const body = parse(z.object({ text, mentions }), req.body);
    const { board } = await access(req.params.id, req.user!.id, req.query.k);
    const c = await thread(board._id, req.params.cid);
    if (c.messages.length >= 200) fail(400, 'This thread is full. Start a new comment.', 'full');
    c.messages.push({ id: id(8), userId: req.user!.id, text: body.text, mentions: body.mentions ?? [], createdAt: new Date() });
    await db.comments.update(c._id, { messages: c.messages, updatedAt: new Date(), resolved: false });
    await tell(board, c, req.user!, body.text, body.mentions ?? []);
    await changed(board._id);
    res.json({ comment: (await view([{ ...c, resolved: false }]))[0] });
  }));

  r.patch('/boards/:id/comments/:cid', requireUser, route(async (req, res) => {
    const body = parse(z.object({
      resolved: z.boolean().optional(), x: z.number().finite().optional(), y: z.number().finite().optional(),
      shapeId: z.string().max(40).nullable().optional(), ox: z.number().finite().optional(), oy: z.number().finite().optional(),
    }), req.body);
    const { board } = await access(req.params.id, req.user!.id, req.query.k);
    const c = await thread(board._id, req.params.cid);
    await db.comments.update(c._id, { ...body, updatedAt: new Date() });
    await changed(board._id);
    res.json({ comment: (await view([{ ...c, ...body } as Comment]))[0] });
  }));

  r.patch('/boards/:id/comments/:cid/replies/:mid', requireUser, route(async (req, res) => {
    const body = parse(z.object({ text }), req.body);
    const { board } = await access(req.params.id, req.user!.id, req.query.k);
    const c = await thread(board._id, req.params.cid);
    const m = c.messages.find((x) => x.id === req.params.mid);
    if (!m) fail(404, 'That reply was deleted.', 'not_found');
    if (m!.userId !== req.user!.id) fail(403, 'You can only edit your own comments.', 'not_yours');
    m!.text = body.text; m!.editedAt = new Date();
    await db.comments.update(c._id, { messages: c.messages, updatedAt: new Date() });
    await changed(board._id);
    res.json({ comment: (await view([c]))[0] });
  }));

  r.delete('/boards/:id/comments/:cid', requireUser, route(async (req, res) => {
    const { board, role } = await access(req.params.id, req.user!.id, req.query.k);
    const c = await thread(board._id, req.params.cid);
    if (c.messages[0]?.userId !== req.user!.id && !canEdit(role)) fail(403, 'Only the person who started this thread, or an editor, can delete it.', 'not_yours');
    await db.comments.delete(c._id);
    await changed(board._id);
    res.json({ ok: true });
  }));

  r.delete('/boards/:id/comments/:cid/replies/:mid', requireUser, route(async (req, res) => {
    const { board, role } = await access(req.params.id, req.user!.id, req.query.k);
    const c = await thread(board._id, req.params.cid);
    const m = c.messages.find((x) => x.id === req.params.mid);
    if (!m) fail(404, 'That reply was deleted.', 'not_found');
    if (m!.userId !== req.user!.id && role !== 'owner') fail(403, 'You can only delete your own comments.', 'not_yours');
    const rest = c.messages.filter((x) => x.id !== m!.id);
    if (!rest.length) await db.comments.delete(c._id); else await db.comments.update(c._id, { messages: rest, updatedAt: new Date() });
    await changed(board._id);
    res.json({ ok: true });
  }));

  return r;
}
