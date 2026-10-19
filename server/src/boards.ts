import { Router } from 'express';
import { z } from 'zod';
import type { Board, Role, Store, User } from './db/types.js';
import { requireUser } from './auth.js';
import { canEdit, roleFor } from './access.js';
import type { Rooms } from './realtime.js';
import { buildTemplate, TEMPLATES } from '../../shared/templates.js';
import { docFromState, readShapes, replaceShapes, writeShapes } from './ydoc.js';
import * as Y from 'yjs';
import { fail, id, parse, route } from './util.js';

const title = z.string().trim().min(1, 'Give the board a name.').max(80, 'Keep the name under 80 characters.');

export function boardJson(b: Board, role: Role, userId: string | undefined, people: Map<string, User>) {
  const person = (uid: string) => { const u = people.get(uid); return u ? { id: u._id, name: u.name, email: u.email, color: u.color } : { id: uid, name: 'Former member', email: '', color: '#9AA5B4' }; };
  return {
    id: b._id,
    title: b.title,
    role,
    owner: person(b.ownerId),
    members: role === 'viewer' ? [] : b.members.map((m) => ({ ...person(m.userId), role: m.role })),
    linkAccess: b.linkAccess,
    linkToken: canEdit(role) ? b.linkToken : undefined,
    starred: userId ? b.starredBy.includes(userId) : false,
    thumbnail: b.thumbnail,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    deletedAt: b.deletedAt,
  };
}

export function boardRoutes(db: Store, rooms: Rooms) {
  const r = Router();

  async function people(boards: Board[]) {
    const ids = new Set<string>();
    boards.forEach((b) => { ids.add(b.ownerId); b.members.forEach((m) => ids.add(m.userId)); });
    const list = await db.users.byIds(Array.from(ids));
    return new Map(list.map((u) => [u._id, u]));
  }

  async function load(boardId: string, userId: string | undefined, k: unknown, need: 'view' | 'edit' | 'owner' = 'view') {
    const b = await db.boards.get(boardId);
    if (!b) fail(404, 'This board doesn’t exist or was deleted.', 'not_found');
    const role = roleFor(b!, userId, typeof k === 'string' ? k : null);
    if (!role) fail(userId ? 403 : 401, userId ? 'You don’t have access to this board. Ask the owner for an invite.' : 'Sign in to open this board.', 'no_access');
    if (need === 'edit' && !canEdit(role)) fail(403, 'You can view this board but not change it.', 'view_only');
    if (need === 'owner' && role !== 'owner') fail(403, 'Only the board owner can do that.', 'owner_only');
    return { board: b!, role: role! };
  }

  r.get('/templates', (_req, res) => { res.json({ templates: TEMPLATES }); });

  r.get('/boards', requireUser, route(async (req, res) => {
    const uid = req.user!.id;
    const all = await db.boards.forUser(uid);
    const map = await people(all);
    res.json({ boards: all.map((b) => boardJson(b, roleFor(b, uid) || 'viewer', uid, map)) });
  }));

  r.post('/boards', requireUser, route(async (req, res) => {
    const body = parse(z.object({ title: title.optional(), template: z.string().max(30).optional() }), req.body ?? {});
    const now = new Date();
    const tpl = TEMPLATES.find((t) => t.id === body.template) ?? TEMPLATES[0];
    const b: Board = {
      _id: id(9), title: body.title || (tpl.id === 'blank' ? 'Untitled board' : tpl.name), ownerId: req.user!.id, members: [],
      linkAccess: 'none', linkToken: id(18), starredBy: [], thumbnail: '', createdAt: now, updatedAt: now, deletedAt: null,
    };
    await db.boards.insert(b);
    if (tpl.id !== 'blank') await rooms.edit(b._id, (doc) => writeShapes(doc, buildTemplate(tpl.id)), req.user!.id);
    const fresh = (await db.boards.get(b._id))!;
    res.status(201).json({ board: boardJson(fresh, 'owner', req.user!.id, await people([fresh])) });
  }));

  r.get('/boards/:id', route(async (req, res) => {
    const { board, role } = await load(req.params.id, req.user?.id, req.query.k);
    res.json({ board: boardJson(board, role, req.user?.id, await people([board])) });
  }));

  r.patch('/boards/:id', requireUser, route(async (req, res) => {
    const body = parse(z.object({ title: title.optional(), linkAccess: z.enum(['none', 'view', 'edit']).optional() }), req.body);
    const { board, role } = await load(req.params.id, req.user!.id, req.query.k, body.linkAccess ? 'owner' : 'edit');
    await db.boards.update(board._id, { ...body, updatedAt: new Date() });
    if (body.linkAccess) await rooms.recheck(board._id);
    const fresh = (await db.boards.get(board._id))!;
    res.json({ board: boardJson(fresh, role, req.user!.id, await people([fresh])) });
  }));

  r.post('/boards/:id/link/reset', requireUser, route(async (req, res) => {
    const { board } = await load(req.params.id, req.user!.id, null, 'owner');
    await db.boards.update(board._id, { linkToken: id(18) });
    await rooms.recheck(board._id);
    const fresh = (await db.boards.get(board._id))!;
    res.json({ board: boardJson(fresh, 'owner', req.user!.id, await people([fresh])) });
  }));

  /** Opening a share link while signed in adds you to the board so it shows on your dashboard. */
  r.post('/boards/:id/join', requireUser, route(async (req, res) => {
    const k = parse(z.object({ k: z.string().min(1).max(60) }), req.body).k;
    const b = await db.boards.get(req.params.id);
    if (!b || b.deletedAt || b.linkAccess === 'none' || b.linkToken !== k) fail(403, 'This invite link no longer works. Ask the owner for a new one.', 'bad_link');
    const uid = req.user!.id;
    if (b!.ownerId !== uid) {
      const want = b!.linkAccess === 'edit' ? 'editor' : 'viewer';
      const existing = b!.members.find((m) => m.userId === uid);
      if (!existing) b!.members.push({ userId: uid, role: want, addedAt: new Date() });
      else if (existing.role === 'viewer' && want === 'editor') existing.role = 'editor';
      await db.boards.update(b!._id, { members: b!.members });
    }
    const fresh = (await db.boards.get(b!._id))!;
    res.json({ board: boardJson(fresh, roleFor(fresh, uid)!, uid, await people([fresh])) });
  }));

  r.post('/boards/:id/members', requireUser, route(async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address.'), role: z.enum(['editor', 'viewer']) }), req.body);
    const { board } = await load(req.params.id, req.user!.id, null, 'owner');
    const u = await db.users.byEmail(body.email);
    if (!u) fail(404, 'No one has a Tessel account with that email yet. Send them the board link instead.', 'no_user');
    if (u!._id === board.ownerId) fail(400, 'That’s you. You already own this board.', 'self');
    const existing = board.members.find((m) => m.userId === u!._id);
    if (existing) existing.role = body.role; else board.members.push({ userId: u!._id, role: body.role, addedAt: new Date() });
    await db.boards.update(board._id, { members: board.members });
    await db.notifications.insert({ _id: id(), userId: u!._id, kind: 'invite', boardId: board._id, fromUserId: req.user!.id, text: `${req.user!.name} invited you to “${board.title}”`, read: false, createdAt: new Date() });
    await rooms.recheck(board._id);
    const fresh = (await db.boards.get(board._id))!;
    res.json({ board: boardJson(fresh, 'owner', req.user!.id, await people([fresh])) });
  }));

  r.patch('/boards/:id/members/:userId', requireUser, route(async (req, res) => {
    const { role: newRole } = parse(z.object({ role: z.enum(['editor', 'viewer']) }), req.body);
    const { board } = await load(req.params.id, req.user!.id, null, 'owner');
    const m = board.members.find((x) => x.userId === req.params.userId);
    if (!m) fail(404, 'That person isn’t on this board.', 'not_member');
    m!.role = newRole;
    await db.boards.update(board._id, { members: board.members });
    await rooms.recheck(board._id);
    const fresh = (await db.boards.get(board._id))!;
    res.json({ board: boardJson(fresh, 'owner', req.user!.id, await people([fresh])) });
  }));

  r.delete('/boards/:id/members/:userId', requireUser, route(async (req, res) => {
    const b = await db.boards.get(req.params.id);
    if (!b) fail(404, 'This board doesn’t exist.', 'not_found');
    const self = req.params.userId === req.user!.id;
    // owners can remove anyone; members can remove themselves (leave)
    if (!self && b!.ownerId !== req.user!.id) fail(403, 'Only the board owner can do that.', 'owner_only');
    await db.boards.update(b!._id, { members: b!.members.filter((m) => m.userId !== req.params.userId) });
    await rooms.recheck(b!._id);
    res.json({ ok: true });
  }));

  r.post('/boards/:id/star', requireUser, route(async (req, res) => {
    const { board } = await load(req.params.id, req.user!.id, req.query.k);
    const uid = req.user!.id;
    const starredBy = board.starredBy.includes(uid) ? board.starredBy.filter((x) => x !== uid) : [...board.starredBy, uid];
    await db.boards.update(board._id, { starredBy });
    res.json({ starred: starredBy.includes(uid) });
  }));

  r.post('/boards/:id/duplicate', requireUser, route(async (req, res) => {
    const { board } = await load(req.params.id, req.user!.id, req.query.k);
    const now = new Date();
    const copy: Board = { ...board, _id: id(9), title: `${board.title} (copy)`.slice(0, 80), ownerId: req.user!.id, members: [], linkAccess: 'none', linkToken: id(18), starredBy: [], createdAt: now, updatedAt: now, deletedAt: null };
    await db.boards.insert(copy);
    const state = await rooms.snapshot(board._id);
    if (state.length) await db.docs.put(copy._id, state);
    res.status(201).json({ board: boardJson(copy, 'owner', req.user!.id, await people([copy])) });
  }));

  r.delete('/boards/:id', requireUser, route(async (req, res) => {
    const { board } = await load(req.params.id, req.user!.id, null, 'owner');
    if (req.query.forever === '1') {
      if (!board.deletedAt) fail(400, 'Move the board to trash first.', 'not_in_trash');
      await Promise.all([db.boards.delete(board._id), db.docs.delete(board._id), db.versions.deleteForBoard(board._id), db.comments.deleteForBoard(board._id)]);
    } else {
      await db.boards.update(board._id, { deletedAt: new Date() });
    }
    await rooms.recheck(board._id);
    res.json({ ok: true });
  }));

  r.post('/boards/:id/restore', requireUser, route(async (req, res) => {
    const { board } = await load(req.params.id, req.user!.id, null, 'owner');
    await db.boards.update(board._id, { deletedAt: null });
    res.json({ ok: true });
  }));

  // ---- version history
  r.get('/boards/:id/versions', route(async (req, res) => {
    const { board } = await load(req.params.id, req.user?.id, req.query.k);
    const list = await db.versions.list(board._id);
    const map = new Map((await db.users.byIds(list.map((v) => v.createdBy).filter(Boolean) as string[])).map((u) => [u._id, u]));
    res.json({ versions: list.map((v) => ({ id: v._id, name: v.name, auto: v.auto, shapeCount: v.shapeCount, createdAt: v.createdAt, by: v.createdBy && map.get(v.createdBy) ? { name: map.get(v.createdBy)!.name, color: map.get(v.createdBy)!.color } : null })) });
  }));

  r.post('/boards/:id/versions', requireUser, route(async (req, res) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1, 'Name this version.').max(60) }), req.body);
    const { board } = await load(req.params.id, req.user!.id, req.query.k, 'edit');
    const state = await rooms.snapshot(board._id);
    const v = { _id: id(), boardId: board._id, name, auto: false, state, shapeCount: readShapes(docFromState(state)).length, createdBy: req.user!.id, createdAt: new Date() };
    await db.versions.insert(v);
    res.status(201).json({ version: { id: v._id, name, auto: false, shapeCount: v.shapeCount, createdAt: v.createdAt, by: { name: req.user!.name, color: req.user!.color } } });
  }));

  r.get('/boards/:id/versions/:vid', route(async (req, res) => {
    const { board } = await load(req.params.id, req.user?.id, req.query.k);
    const v = await db.versions.get(req.params.vid);
    if (!v || v.boardId !== board._id) fail(404, 'That version no longer exists.', 'not_found');
    res.json({ shapes: readShapes(docFromState(v!.state)) });
  }));

  r.post('/boards/:id/versions/:vid/restore', requireUser, route(async (req, res) => {
    const { board } = await load(req.params.id, req.user!.id, req.query.k, 'edit');
    const v = await db.versions.get(req.params.vid);
    if (!v || v.boardId !== board._id) fail(404, 'That version no longer exists.', 'not_found');
    // keep what was there before the restore, so a restore can itself be undone
    const before = await rooms.snapshot(board._id);
    await db.versions.insert({ _id: id(), boardId: board._id, name: 'Before restoring', auto: false, state: before, shapeCount: readShapes(docFromState(before)).length, createdBy: req.user!.id, createdAt: new Date() });
    const shapes = readShapes(docFromState(v!.state));
    await rooms.edit(board._id, (doc: Y.Doc) => replaceShapes(doc, shapes), req.user!.id);
    res.json({ ok: true, shapeCount: shapes.length });
  }));

  return r;
}
