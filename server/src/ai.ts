import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import type { Store } from './db/types.js';
import { requireUser } from './auth.js';
import { canEdit, roleFor } from './access.js';
import type { Rooms } from './realtime.js';
import { config } from './config.js';
import { HttpError, fail, id, parse, route } from './util.js';
import type { TShape } from '../../shared/templates.js';
import { STICKY } from '../../shared/templates.js';

/** Anything that can answer a prompt with JSON matching a schema. Gemini in production, a fake in tests. */
export type AiModel = (prompt: string, schema: object) => Promise<unknown>;

// ---------- Gemini over plain HTTPS (no SDK needed)
let resolvedModel: string | null = null;
async function pickModel(key: string): Promise<string> {
  if (resolvedModel) return resolvedModel;
  // prefer the configured model; if Google retired it, fall back to the newest Flash model this key can use
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
  if (!r.ok) return config.geminiModel;
  const data = (await r.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const names = (data.models || []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  if (names.includes(config.geminiModel)) return (resolvedModel = config.geminiModel);
  const flash = names.filter((n) => /flash/.test(n) && !/lite|image|tts|live|audio|thinking|exp/.test(n)).sort().reverse();
  return (resolvedModel = flash[0] || names[0] || config.geminiModel);
}

const LITE = 'gemini-flash-lite-latest';
type Attempt = { model: string; schema: boolean; thinking?: object };
let working: Attempt | null = null; // the first setup that worked is reused for later requests

export const gemini: AiModel = async (prompt, schema) => {
  if (!config.geminiKey) fail(503, 'AI isn’t switched on for this server yet. The owner needs to add a Gemini key.', 'ai_off');
  const call = (a: Attempt) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(a.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: a.schema ? prompt : `${prompt}\n\nReply with JSON only, matching this JSON schema:\n${JSON.stringify(schema)}` }] }],
      generationConfig: {
        responseMimeType: 'application/json', temperature: 0.4,
        ...(a.schema ? { responseSchema: schema } : {}),
        // these tasks need speed, not long reasoning: thinking models are asked to think briefly
        ...(a.thinking ? { thinkingConfig: a.thinking } : {}),
      },
    }),
    signal: AbortSignal.timeout(25000),
  });
  const main = config.geminiModel;
  const attempts: Attempt[] = [
    // the light model answers in a couple of seconds and is plenty for sorting and short text,
    // so it goes first; the bigger model is the backup. This also holds right after the server wakes up.
    ...(working ? [working] : []),
    { model: LITE, schema: true },
    { model: main, schema: true, thinking: { thinkingBudget: 0 } },
    { model: main, schema: true, thinking: { thinkingLevel: 'minimal' } },
    { model: LITE, schema: false },
    { model: main, schema: false },
  ].filter((a, i, arr) => arr.findIndex((b) => JSON.stringify(b) === JSON.stringify(a)) === i);
  let lastErr = '';
  let busy = false;
  const started = Date.now();
  for (const a of attempts) {
    if (Date.now() - started > 70000) break; // don't keep the person waiting forever
    let r: Response;
    const t0 = Date.now();
    try { r = await call(a); } catch (e) { lastErr = `${a.model}: ${(e as Error).name === 'TimeoutError' ? 'timed out' : String(e)}`; console.error('gemini', lastErr); continue; }
    if (r.ok) {
      const data = (await r.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      const json = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      try { const out = JSON.parse(json); working = Date.now() - t0 < 15000 ? a : working; return out; } catch { lastErr = `${a.model}: bad json ${text.slice(0, 160)}`; continue; }
    }
    const body = (await r.text()).slice(0, 600);
    lastErr = `${r.status} ${a.model}: ${body.replace(/\s+/g, ' ').slice(0, 300)}`;
    console.error('gemini', lastErr);
    if (r.status === 429) { busy = true; continue; } // this model's free limit is used up; another model has its own
    if (/API key not valid|API_KEY_INVALID|API has not been used|SERVICE_DISABLED/i.test(body)) fail(503, 'The Gemini key on the server isn’t working. Check GEMINI_API_KEY in Render.', 'ai_key');
    if (/location is not supported/i.test(body)) fail(503, 'Gemini’s free plan isn’t available for this server’s region.', 'ai_region');
  }
  console.error('gemini gave up:', lastErr);
  if (busy) fail(429, 'The AI is busy right now (free plan limit). Try again in a minute.', 'ai_busy');
  throw Object.assign(new HttpError(502, 'The AI couldn’t answer this time. Try again.', 'ai_failed'), { detail: lastErr });
};

/** Lets the owner see why AI isn't working without reading server logs. */
export async function aiDiagnose() {
  if (!config.geminiKey) return { ok: false, reason: 'No GEMINI_API_KEY set' };
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': config.geminiKey } }).catch((e) => e as Error);
  if (r instanceof Error) return { ok: false, reason: 'Could not reach Google: ' + r.message };
  if (!r.ok) return { ok: false, status: r.status, reason: (await r.text()).slice(0, 300) };
  const data = (await r.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const names = (data.models || []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  // try one tiny real request, with and without a schema, and report exactly what Google says
  const using = await pickModel(config.geminiKey);
  const probe = async (withSchema: boolean) => {
    const body = { contents: [{ role: 'user', parts: [{ text: 'Reply with {"ok": true}' }] }], generationConfig: withSchema ? { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] } } : { responseMimeType: 'application/json' } };
    const t0 = Date.now();
    try {
      const rr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(using)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
      return { status: rr.status, ms: Date.now() - t0, body: (await rr.text()).slice(0, 700) };
    } catch (e) { return { error: String(e), ms: Date.now() - t0 }; }
  };
  const probes = { withSchema: await probe(true), withoutSchema: await probe(false) };
  return { ok: true, probes, configured: config.geminiModel, configuredAvailable: names.includes(config.geminiModel), using: await pickModel(config.geminiKey), flashModels: names.filter((n) => /flash/.test(n)).slice(0, 12) };
}

// ---------- layouts (pure functions, so they are easy to test)
type New = Omit<TShape, 'z'>;
const sid = () => id(8);
const clip = (t: string, n = 300) => t.replace(/\s+/g, ' ').trim().slice(0, n);

export function bounds(shapes: TShape[]) {
  if (!shapes.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  shapes.forEach((s) => { x1 = Math.min(x1, s.x); y1 = Math.min(y1, s.y); x2 = Math.max(x2, s.x + s.w); y2 = Math.max(y2, s.y + s.h); });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Puts each group of notes into its own titled frame, laid out in rows of up to three frames. */
export function layoutGroups(notes: TShape[], groups: { title: string; ids: string[] }[], origin: { x: number; y: number }) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const clean = groups.map((g) => ({ title: clip(g.title, 60) || 'Group', ids: g.ids.filter((i) => byId.has(i) && !seen.has(i) && (seen.add(i), true)) })).filter((g) => g.ids.length);
  const leftover = notes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  if (leftover.length) clean.push({ title: 'Other', ids: leftover });
  const cw = Math.max(...notes.map((n) => n.w)), ch = Math.max(...notes.map((n) => n.h));
  const gap = 22, pad = 28, frameGap = 60;
  const frames: New[] = []; const moves: Record<string, { x: number; y: number }> = {};
  let x = origin.x, y = origin.y, rowH = 0;
  clean.forEach((g, gi) => {
    const cols = Math.min(3, g.ids.length), rows = Math.ceil(g.ids.length / cols);
    const fw = pad * 2 + cols * cw + (cols - 1) * gap, fh = pad * 2 + rows * ch + (rows - 1) * gap;
    if (gi > 0 && gi % 3 === 0) { x = origin.x; y += rowH + frameGap + 30; rowH = 0; }
    frames.push({ id: sid(), type: 'frame', x, y, w: fw, h: fh, text: g.title });
    g.ids.forEach((nid, i) => { moves[nid] = { x: x + pad + (i % cols) * (cw + gap), y: y + pad + Math.floor(i / cols) * (ch + gap) }; });
    x += fw + frameGap; rowH = Math.max(rowH, fh);
  });
  return { frames, moves };
}

type Node = { id: string; label: string; kind: 'start' | 'step' | 'decision' | 'end' };
type Edge = { from: string; to: string; label?: string };

/** Top-to-bottom flowchart: each node sits one row below the furthest node that leads to it. */
export function layoutDiagram(nodes: Node[], edges: Edge[], center: { x: number; y: number }) {
  const ok = new Set(nodes.map((n) => n.id));
  const es = edges.filter((e) => ok.has(e.from) && ok.has(e.to) && e.from !== e.to);
  const level = new Map<string, number>();
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  es.forEach((e) => incoming.set(e.to, (incoming.get(e.to) || 0) + 1));
  const roots = nodes.filter((n) => !incoming.get(n.id)).map((n) => n.id);
  const queue = (roots.length ? roots : [nodes[0]?.id]).filter(Boolean) as string[];
  // drop edges that loop back to an earlier step, so loops don't push nodes down forever
  const out = new Map<string, string[]>();
  es.forEach((e) => out.set(e.from, [...(out.get(e.from) || []), e.to]));
  const back = new Set<Edge>(); const state = new Map<string, 1 | 2>();
  const visit = (n: string) => {
    state.set(n, 1);
    es.filter((e) => e.from === n).forEach((e) => {
      if (state.get(e.to) === 1) back.add(e); else if (!state.has(e.to)) visit(e.to);
    });
    state.set(n, 2);
  };
  queue.forEach(visit); nodes.forEach((n) => { if (!state.has(n.id)) visit(n.id); });
  const fwd = es.filter((e) => !back.has(e));
  queue.forEach((r) => level.set(r, 0));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    fwd.forEach((e) => { const l = (level.get(e.from) ?? 0) + 1; if (l > (level.get(e.to) ?? -1)) { level.set(e.to, l); changed = true; } });
    if (!changed) break;
  }
  nodes.forEach((n) => { if (!level.has(n.id)) level.set(n.id, 0); });
  const rows = new Map<number, Node[]>();
  nodes.forEach((n) => { const l = level.get(n.id)!; rows.set(l, [...(rows.get(l) || []), n]); });
  const size = (k: Node['kind']) => (k === 'decision' ? [150, 150] : k === 'step' ? [200, 90] : [180, 84]);
  const look: Record<Node['kind'], { type: TShape['type']; color: string }> = {
    start: { type: 'ellipse', color: '#B6EBC6' }, end: { type: 'ellipse', color: '#FFC3A0' },
    step: { type: 'rect', color: '#FFFFFF' }, decision: { type: 'diamond', color: '#FFE47A' },
  };
  const rowGap = 210, colGap = 250;
  const total = rows.size;
  const shapes: New[] = []; const idMap = new Map<string, string>(); const pos = new Map<string, TShape | New>();
  Array.from(rows.keys()).sort((a, b) => a - b).forEach((l) => {
    const row = rows.get(l)!;
    row.forEach((n, i) => {
      const [w, h] = size(n.kind);
      const cx = center.x + (i - (row.length - 1) / 2) * colGap;
      const cy = center.y + (l - (total - 1) / 2) * rowGap;
      const s: New = { id: sid(), type: look[n.kind]?.type || 'rect', x: cx - w / 2, y: cy - h / 2, w, h, text: clip(n.label, 80), color: look[n.kind]?.color || '#FFFFFF' };
      idMap.set(n.id, s.id); pos.set(n.id, s); shapes.push(s);
    });
  });
  es.forEach((e) => {
    shapes.push({ id: sid(), type: 'arrow', x: 0, y: 0, w: 0, h: 0, from: { id: idMap.get(e.from), x: 0, y: 0 }, to: { id: idMap.get(e.to), x: 0, y: 0 }, stroke: 'ink' });
    if (e.label?.trim()) {
      const a = pos.get(e.from)!, b = pos.get(e.to)!;
      const mx = (a.x + a.w / 2 + b.x + b.w / 2) / 2, my = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
      shapes.push({ id: sid(), type: 'text', x: mx + 8, y: my - 14, w: 90, h: 24, text: clip(e.label, 20), size: 15, stroke: '#5B6578' });
    }
  });
  return shapes;
}

/** New ideas placed around the note they grew from, in the nearest free spots, each linked back to it. */
export function layoutRing(source: TShape, ideas: string[], existing: TShape[] = []) {
  const cx = source.x + source.w / 2, cy = source.y + source.h / 2;
  const w = 170, h = 150, gap = 24;
  const taken: { x: number; y: number; w: number; h: number }[] = existing.filter((e) => e.type !== 'arrow' && e.type !== 'frame' && e.id !== source.id).map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));
  taken.push({ x: source.x, y: source.y, w: source.w, h: source.h });
  const free = (x: number, y: number) => taken.every((t) => x + w + gap <= t.x || x >= t.x + t.w + gap || y + h + gap <= t.y || y >= t.y + t.h + gap);
  const out: New[] = [];
  const base = Math.max(source.w, source.h) / 2 + 190;
  ideas.forEach((t, i) => {
    let spot: { x: number; y: number } | null = null;
    // start where an even ring would put it, then search outwards for room
    for (let ring = 0; ring < 6 && !spot; ring++) {
      const r = base + ring * 190;
      for (let k = 0; k < 24 && !spot; k++) {
        const a = -Math.PI / 2 + (i / ideas.length) * Math.PI * 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
        const x = cx + Math.cos(a) * r - w / 2, y = cy + Math.sin(a) * r - h / 2;
        if (free(x, y)) spot = { x, y };
      }
    }
    const p = spot ?? { x: cx + base + i * (w + gap), y: cy - h / 2 };
    taken.push({ ...p, w, h });
    const note: New = { id: sid(), type: 'sticky', x: p.x, y: p.y, w, h, text: clip(t, 140), color: STICKY[(i + 1) % STICKY.length] };
    out.push(note);
    out.push({ id: sid(), type: 'arrow', x: 0, y: 0, w: 0, h: 0, from: { id: source.id, x: 0, y: 0 }, to: { id: note.id, x: 0, y: 0 }, stroke: 'ink' });
  });
  return out;
}

/** Moves a new block of shapes to empty space if it would land on top of existing ones. */
export function placeClear(shapes: New[], existing: TShape[]) {
  const solid = shapes.filter((s) => s.type !== 'arrow');
  const box = bounds(solid as TShape[]);
  const others = existing.filter((e) => e.type !== 'arrow');
  const hit = others.some((e) => e.x < box.x + box.w + 40 && e.x + e.w > box.x - 40 && e.y < box.y + box.h + 40 && e.y + e.h > box.y - 40);
  if (!hit || !others.length) return shapes;
  const all = bounds(others);
  const dx = all.x + all.w + 160 - box.x;
  return shapes.map((s) => (s.type === 'arrow' ? s : { ...s, x: s.x + dx }));
}

// ---------- the endpoint
const STR = { type: 'STRING' } as const;
const schemas = {
  organise: { type: 'OBJECT', properties: { groups: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: STR, ids: { type: 'ARRAY', items: STR } }, required: ['title', 'ids'] } } }, required: ['groups'] },
  summarise: { type: 'OBJECT', properties: { title: STR, points: { type: 'ARRAY', items: STR } }, required: ['title', 'points'] },
  diagram: {
    type: 'OBJECT', properties: {
      nodes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: STR, label: STR, kind: { type: 'STRING', enum: ['start', 'step', 'decision', 'end'] } }, required: ['id', 'label', 'kind'] } },
      edges: { type: 'ARRAY', items: { type: 'OBJECT', properties: { from: STR, to: STR, label: STR }, required: ['from', 'to'] } },
    }, required: ['nodes', 'edges'],
  },
  expand: { type: 'OBJECT', properties: { ideas: { type: 'ARRAY', items: STR } }, required: ['ideas'] },
};

const textOf = (s: TShape) => clip(s.text || '');

/**
 * The server works out WHAT to change and sends it back; the person's own browser applies it.
 * That makes every AI change part of that person's undo history, like any edit they make by hand,
 * and it syncs to everyone else through the normal live connection.
 */
export function aiRoutes(db: Store, rooms: Rooms, model: AiModel = gemini) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip || ''),
    message: { error: 'That’s a lot of AI requests. Wait a few minutes, then try again.', code: 'rate_limited' },
  });

  r.post('/boards/:id/ai', requireUser, limiter, route(async (req, res) => {
    const body = parse(z.object({
      action: z.enum(['organise', 'summarise', 'diagram', 'expand']),
      ids: z.array(z.string().max(40)).max(300).optional(),
      prompt: z.string().trim().max(600).optional(),
      at: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
    }), req.body);
    const b = await db.boards.get(req.params.id);
    if (!b) fail(404, 'This board doesn’t exist.', 'not_found');
    const role = roleFor(b!, req.user!.id, typeof req.query.k === 'string' ? req.query.k : null);
    if (!canEdit(role)) fail(403, 'You can view this board but not change it.', 'view_only');

    const all = await rooms.shapes(b!._id);
    const chosen = body.ids?.length ? all.filter((s) => body.ids!.includes(s.id)) : all;
    const notes = chosen.filter((s) => ['sticky', 'text', 'rect', 'ellipse', 'diamond'].includes(s.type) && textOf(s));
    const keep = async (label: string) => {
      const state = await rooms.snapshot(b!._id);
      const vid = id();
      await db.versions.insert({ _id: vid, boardId: b!._id, name: `Before AI: ${label}`, auto: false, state, shapeCount: all.length, createdBy: req.user!.id, createdAt: new Date() });
      return vid;
    };

    if (body.action === 'organise') {
      const stickies = notes.filter((s) => s.type === 'sticky');
      if (stickies.length < 3) fail(400, 'Select at least 3 sticky notes to organise.', 'too_few');
      const list = stickies.slice(0, 150).map((s) => `${s.id}: ${textOf(s)}`).join('\n');
      const out = await model(`You organise sticky notes from a team whiteboard into themes.
Group the notes below into 2 to 6 clear themes. Give each theme a short title of 1 to 4 words, in the same language as the notes. Every note id must appear in exactly one group. Use the ids exactly as given.

Notes (id: text):
${list}`, schemas.organise) as { groups: { title: string; ids: string[] }[] };
      const groups = Array.isArray(out?.groups) ? out.groups : [];
      if (!groups.length) fail(502, 'The AI couldn’t find themes in these notes. Try again.', 'ai_bad');
      const box = bounds(stickies);
      const { frames, moves } = layoutGroups(stickies, groups, { x: box.x, y: box.y });
      const versionId = await keep('organise');
      // selected frames left empty by the move are replaced by the new groups
      const moved = new Set(Object.keys(moves));
      const emptied = chosen.filter((f) => f.type === 'frame' && !all.some((s) => s.type !== 'frame' && !moved.has(s.id) && s.x >= f.x && s.y >= f.y && s.x + s.w <= f.x + f.w && s.y + s.h <= f.y + f.h)).map((f) => f.id);
      return res.json({ ok: true, ops: { create: frames, update: moves, remove: emptied }, ids: [...frames.map((f) => f.id), ...Object.keys(moves)], message: `Sorted ${Object.keys(moves).length} notes into ${frames.length} groups.`, versionId });
    }

    if (body.action === 'summarise') {
      if (!notes.length) fail(400, 'There’s no text on this board to summarise yet.', 'empty');
      const list = notes.slice(0, 200).map((s) => `- ${textOf(s)}`).join('\n');
      const out = await model(`Summarise this team whiteboard for someone who missed the session.
Write a title of at most 6 words and 3 to 6 short points (each under 18 words). Use the same language as the notes. Only use what is on the board.

Board content:
${list}`, schemas.summarise) as { title: string; points: string[] };
      const points = (out?.points || []).map((p) => clip(String(p), 160)).filter(Boolean).slice(0, 8);
      if (!points.length) fail(502, 'The AI couldn’t summarise this board. Try again.', 'ai_bad');
      const box = bounds(chosen.length ? chosen : all);
      const text = `${clip(out.title || 'Summary', 60)}\n${points.map((p) => `• ${p}`).join('\n')}`;
      const [note] = placeClear([{ id: sid(), type: 'sticky', x: box.x + box.w + 80, y: box.y, w: 340, h: 300, text, color: '#D8C8FF', align: 'left' }], all);
      return res.json({ ok: true, ops: { create: [note] }, ids: [note.id], message: 'Summary added to the board.' });
    }

    if (body.action === 'diagram') {
      if (!body.prompt || body.prompt.length < 3) fail(400, 'Describe what to draw, for example “how a food delivery order works”.', 'no_prompt');
      const out = await model(`Draw a flowchart for: "${body.prompt}".
Use 4 to 12 nodes. Kinds: "start" for the first node, "end" for final outcomes, "decision" for yes/no questions (label ends with ?), "step" for actions. Labels are short (2 to 6 words). Decision edges get labels like "Yes" and "No". Node ids are short like n1, n2. Use the language of the request.`, schemas.diagram) as { nodes: Node[]; edges: Edge[] };
      const nodes = (out?.nodes || []).slice(0, 16).filter((n) => n && n.id && n.label);
      if (nodes.length < 2) fail(502, 'The AI couldn’t draw that. Try describing it differently.', 'ai_bad');
      const at = body.at ?? (() => { const bx = bounds(all); return { x: bx.x + bx.w + 400, y: bx.y + 300 }; })();
      const shapes = placeClear(layoutDiagram(nodes, out.edges || [], at), all);
      return res.json({ ok: true, ops: { create: shapes }, ids: shapes.map((s) => s.id), message: `Drew ${nodes.length} steps.` });
    }

    // expand
    const source = notes.length === 1 ? notes[0] : null;
    if (!source) fail(400, 'Select one note with text to grow ideas from it.', 'select_one');
    const context = all.filter((s) => s.id !== source!.id && textOf(s)).slice(0, 40).map((s) => `- ${textOf(s, )}`).join('\n');
    const out = await model(`A team is brainstorming on a whiteboard. Suggest 5 new, specific ideas that build on this note: "${textOf(source!)}".
Each idea is under 14 words, practical, and different from the others and from what is already on the board. Same language as the note.

Already on the board:
${context || '(nothing else yet)'}`, schemas.expand) as { ideas: string[] };
    const ideas = (out?.ideas || []).map((t) => clip(String(t), 140)).filter(Boolean).slice(0, 6);
    if (!ideas.length) fail(502, 'The AI couldn’t come up with ideas this time. Try again.', 'ai_bad');
    const shapes = layoutRing(source!, ideas, all);
    return res.json({ ok: true, ops: { create: shapes }, ids: shapes.filter((s) => s.type === 'sticky').map((s) => s.id), message: `Added ${ideas.length} ideas.` });
  }));

  r.get('/ai/status', route(async (req, res) => {
    if (req.query.check === '1') return res.json({ enabled: !!config.geminiKey, check: await aiDiagnose() });
    if (req.query.check === '2') {
      // a full-size request, timed, exactly like "Draw it for me"
      const t0 = Date.now();
      try { const out = await model('Draw a flowchart for: "how a customer orders food". Use 4 to 12 nodes. Kinds: start, step, decision, end. Short labels. Node ids like n1.', schemas.diagram); return res.json({ ok: true, ms: Date.now() - t0, working, out }); }
      catch (e) { return res.json({ ok: false, ms: Date.now() - t0, error: (e as Error).message, detail: (e as { detail?: string }).detail }); }
    }
    if (req.query.check === '3') {
      // an organise request like the real one, timed
      const t0 = Date.now();
      const list = ['price is too high', 'delivery takes long', 'cheaper plan', 'faster checkout', 'discount codes', 'live tracking'].map((t, i) => `n${i}: ${t}`).join('\n');
      try { const out = await model(`You organise sticky notes from a team whiteboard into themes.\nGroup the notes below into 2 to 6 clear themes. Give each theme a short title of 1 to 4 words. Every note id must appear in exactly one group. Use the ids exactly as given.\n\nNotes (id: text):\n${list}`, schemas.organise); return res.json({ ok: true, ms: Date.now() - t0, working, out }); }
      catch (e) { return res.json({ ok: false, ms: Date.now() - t0, error: (e as Error).message, detail: (e as { detail?: string }).detail }); }
    }
    res.json({ enabled: !!config.geminiKey });
  }));
  return r;
}

