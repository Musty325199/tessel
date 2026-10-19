import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { memoryStore } from '../src/db/memory.js';
import { layoutDiagram, layoutGroups } from '../src/ai.js';
import type { TShape } from '../../shared/templates.js';

const note = (id: string, text: string, x = 0, y = 0): TShape => ({ id, type: 'sticky', x, y, w: 180, h: 160, z: 1, text });

describe('AI layouts', () => {
  it('puts every note in exactly one frame, even ones the model forgot', () => {
    const notes = [note('a', 'Price'), note('b', 'Cost'), note('c', 'Speed'), note('d', 'Fast')];
    const { frames, moves } = layoutGroups(notes, [{ title: 'Money', ids: ['a', 'b', 'zzz'] }, { title: 'Speed', ids: ['c', 'a'] }], { x: 0, y: 0 });
    expect(Object.keys(moves).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(frames.map((f) => f.text)).toEqual(['Money', 'Speed', 'Other']);
    // each moved note sits inside its frame
    const inside = (id: string, f: { x: number; y: number; w: number; h: number }) => moves[id].x >= f.x && moves[id].x + 180 <= f.x + f.w && moves[id].y >= f.y && moves[id].y + 160 <= f.y + f.h;
    expect(inside('a', frames[0]) && inside('b', frames[0]) && inside('c', frames[1]) && inside('d', frames[2])).toBe(true);
  });

  it('lays a flowchart out top to bottom and survives loops', () => {
    const shapes = layoutDiagram(
      [{ id: 'n1', label: 'Start', kind: 'start' }, { id: 'n2', label: 'Pay?', kind: 'decision' }, { id: 'n3', label: 'Ship', kind: 'step' }, { id: 'n4', label: 'Done', kind: 'end' }],
      [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3', label: 'Yes' }, { from: 'n3', to: 'n4' }, { from: 'n3', to: 'n2' }, { from: 'n2', to: 'missing' }],
      { x: 0, y: 0 },
    );
    const boxes = shapes.filter((s) => s.type !== 'arrow' && s.type !== 'text');
    const y = (label: string) => boxes.find((s) => s.text === label)!.y;
    expect(y('Start')).toBeLessThan(y('Pay?'));
    expect(y('Pay?')).toBeLessThan(y('Ship'));
    expect(shapes.filter((s) => s.type === 'arrow')).toHaveLength(4); // the edge to a missing node is dropped
    expect(shapes.some((s) => s.type === 'text' && s.text === 'Yes')).toBe(true);
  });
});

describe('AI endpoint', () => {
  it('organises notes on a live board and keeps a version to undo it', async () => {
    const db = memoryStore();
    const fake = async (prompt: string) => {
      const ids = Array.from(prompt.matchAll(/^(\S+): /gm)).map((m) => m[1]);
      return { groups: [{ title: 'First half', ids: ids.slice(0, 2) }, { title: 'Second half', ids: ids.slice(2) }] };
    };
    const { app, rooms } = createApp(db, { ai: fake });
    const s = (await request(app).post('/api/auth/signup').send({ name: 'Ai', email: 'ai@example.com', password: 'correct horse 9' })).body;
    const auth = { Authorization: `Bearer ${s.accessToken}` };
    const board = (await request(app).post('/api/boards').set(auth).send({ template: 'brainstorm' })).body.board;
    const before = await rooms.shapes(board.id);
    const ids = before.filter((x) => x.type === 'sticky').map((x) => x.id);
    const r = await request(app).post(`/api/boards/${board.id}/ai`).set(auth).send({ action: 'organise', ids });
    expect(r.status).toBe(200);
    const after = await rooms.shapes(board.id);
    expect(after.filter((x) => x.type === 'frame').map((f) => f.text)).toEqual(expect.arrayContaining(['First half', 'Second half']));
    const versions = (await request(app).get(`/api/boards/${board.id}/versions`).set(auth)).body.versions;
    expect(versions.some((v: { name: string }) => v.name === 'Before AI: organise')).toBe(true);

    // too few notes and view-only users are refused
    expect((await request(app).post(`/api/boards/${board.id}/ai`).set(auth).send({ action: 'organise', ids: ids.slice(0, 1) })).status).toBe(400);
    const v = (await request(app).post('/api/auth/signup').send({ name: 'V', email: 'v@example.com', password: 'correct horse 9' })).body;
    expect((await request(app).post(`/api/boards/${board.id}/ai`).set({ Authorization: `Bearer ${v.accessToken}` }).send({ action: 'summarise' })).status).toBe(403);
  });
});
