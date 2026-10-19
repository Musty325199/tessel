import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { memoryStore } from '../src/db/memory.js';

describe('comments', () => {
  it('threads, mentions, resolve and permissions', async () => {
    const db = memoryStore();
    const { app } = createApp(db);
    const sign = async (name: string, email: string) => (await request(app).post('/api/auth/signup').send({ name, email, password: 'correct horse 9' })).body;
    const a = await sign('Ada', 'ada@c.com'), b = await sign('Bayo', 'bayo@c.com'), c = await sign('Chi', 'chi@c.com');
    const A = { Authorization: `Bearer ${a.accessToken}` }, B = { Authorization: `Bearer ${b.accessToken}` }, C = { Authorization: `Bearer ${c.accessToken}` };
    const board = (await request(app).post('/api/boards').set(A).send({})).body.board;
    await request(app).post(`/api/boards/${board.id}/members`).set(A).send({ email: 'bayo@c.com', role: 'viewer' });

    // viewers can comment; strangers can't
    const t = await request(app).post(`/api/boards/${board.id}/comments`).set(B).send({ x: 10, y: 20, text: 'Looks good @Ada', mentions: [a.user.id, c.user.id] });
    expect(t.status).toBe(201);
    expect((await request(app).post(`/api/boards/${board.id}/comments`).set(C).send({ x: 0, y: 0, text: 'hi' })).status).toBe(403);
    // only people on the board can be mentioned
    const notesA = (await request(app).get('/api/notifications').set(A)).body.notifications;
    expect(notesA[0].kind).toBe('mention');
    expect((await request(app).get('/api/notifications').set(C)).body.notifications).toHaveLength(0);

    const cid = t.body.comment.id;
    await request(app).post(`/api/boards/${board.id}/comments/${cid}/replies`).set(A).send({ text: 'Thanks!' }).expect(200);
    expect((await request(app).get('/api/notifications').set(B)).body.notifications.some((n: { kind: string }) => n.kind === 'reply')).toBe(true);
    await request(app).patch(`/api/boards/${board.id}/comments/${cid}`).set(A).send({ resolved: true }).expect(200);
    const list = (await request(app).get(`/api/boards/${board.id}/comments`).set(B)).body.comments;
    expect(list[0].resolved).toBe(true);
    expect(list[0].messages.map((m: { author: { name: string } }) => m.author.name)).toEqual(['Bayo', 'Ada']);
    // a viewer can't delete someone else's reply
    const reply = list[0].messages[1].id;
    expect((await request(app).delete(`/api/boards/${board.id}/comments/${cid}/replies/${reply}`).set(B)).status).toBe(403);
    // the owner can delete the thread
    await request(app).delete(`/api/boards/${board.id}/comments/${cid}`).set(A).expect(200);
    expect((await request(app).get(`/api/boards/${board.id}/comments`).set(A)).body.comments).toHaveLength(0);
  });
});
