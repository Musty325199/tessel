import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { memoryStore } from '../src/db/memory.js';
import { config } from '../src/config.js';

describe('forgot password', () => {
  afterEach(() => { vi.unstubAllGlobals(); config.resendKey = ''; config.mailFrom = ''; });

  it('emails a single-use link that sets a new password and signs out other devices', async () => {
    const { app } = createApp(memoryStore());
    const s = (await request(app).post('/api/auth/signup').send({ name: 'Ada', email: 'ada@example.com', password: 'old password 1' })).body;

    // email off: says so plainly
    expect((await request(app).post('/api/auth/forgot').send({ email: 'ada@example.com' })).status).toBe(503);

    config.resendKey = 'test'; config.mailFrom = 'Tessel <a@b.c>';
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => { sent.push(JSON.parse(init.body).text); return new Response('{}', { status: 200 }); });

    // unknown emails get the same answer and no email
    expect((await request(app).post('/api/auth/forgot').send({ email: 'nobody@example.com' })).body).toEqual({ ok: true });
    expect(sent).toHaveLength(0);

    expect((await request(app).post('/api/auth/forgot').send({ email: 'ADA@example.com' })).body).toEqual({ ok: true });
    const token = sent[0].match(/reset\?t=([\w.-]+)/)![1];

    expect((await request(app).post('/api/auth/reset').send({ token: token + 'x', password: 'new password 2' })).status).toBe(400);
    const ok = await request(app).post('/api/auth/reset').send({ token, password: 'new password 2' });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    // works once
    expect((await request(app).post('/api/auth/reset').send({ token, password: 'another one 3' })).status).toBe(400);
    // old password and old sessions are gone, new password works
    expect((await request(app).post('/api/auth/login').send({ email: 'ada@example.com', password: 'old password 1' })).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'ada@example.com', password: 'new password 2' })).status).toBe(200);
  });
});
