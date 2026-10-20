import { useEffect, useState } from 'react';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8787';
export const WS_URL = API_URL.replace(/^http/, 'ws');

export type User = { id: string; name: string; email: string; color: string };
export type Person = { id: string; name: string; email: string; color: string };
export type BoardInfo = {
  id: string; title: string; role: 'owner' | 'editor' | 'viewer';
  owner: Person; members: (Person & { role: 'editor' | 'viewer' })[];
  linkAccess: 'none' | 'view' | 'edit'; linkToken?: string; starred: boolean; thumbnail: string;
  createdAt: string; updatedAt: string; deletedAt: string | null;
};
export type VersionInfo = { id: string; name: string | null; auto: boolean; shapeCount: number; createdAt: string; by: { name: string; color: string } | null };
export type NotificationInfo = { id: string; kind: string; boardId: string; text: string; read: boolean; createdAt: string; from: { name: string; color: string } | null };

const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* blocked */ } },
};

/* The access token lives in memory only. The refresh token is kept on this device so you stay signed in. */
let access: string | null = null;
let accessExp = 0;
let user: User | null = (() => { try { return JSON.parse(ls.get('tessel:user') || 'null'); } catch { return null; } })();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

type Session = { user: User; accessToken: string; refreshToken: string; expiresIn: number };
function setSession(s: Session | null) {
  if (!s) { access = null; accessExp = 0; user = null; ls.set('tessel:rt', null); ls.set('tessel:user', null); emit(); return; }
  access = s.accessToken; accessExp = Date.now() + (s.expiresIn - 30) * 1000; user = s.user;
  ls.set('tessel:rt', s.refreshToken); ls.set('tessel:user', JSON.stringify(s.user)); emit();
}

export class ApiError extends Error { constructor(public status: number, message: string, public code = '') { super(message); } }

let refreshing: Promise<string | null> | null = null;
/** One refresh at a time, even if many requests notice an expired token together. */
export function freshToken(): Promise<string | null> {
  if (access && Date.now() < accessExp) return Promise.resolve(access);
  const rt = ls.get('tessel:rt');
  if (!rt) return Promise.resolve(null);
  if (!refreshing) {
    refreshing = fetch(API_URL + '/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
      .then(async (r) => {
        if (r.status === 401) { setSession(null); return null; }
        if (!r.ok) return null;
        const s = await r.json() as Session; setSession(s); return s.accessToken;
      })
      .catch(() => null)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) { const t = await freshToken(); if (t) headers.Authorization = `Bearer ${t}`; }
  let r: Response;
  try {
    r = await fetch(API_URL + path, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, 'Can’t reach Tessel right now. Check your connection. If the server was asleep, it can take up to a minute to wake.', 'network');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error || 'Something went wrong. Try again.', data.code);
  return data as T;
}

export const auth = {
  async signup(name: string, email: string, password: string) { setSession(await api<Session>('/api/auth/signup', { method: 'POST', body: { name, email, password }, auth: false })); },
  async login(email: string, password: string) { setSession(await api<Session>('/api/auth/login', { method: 'POST', body: { email, password }, auth: false })); },
  async forgot(email: string) { await api('/api/auth/forgot', { method: 'POST', body: { email }, auth: false }); },
  async reset(token: string, password: string) { setSession(await api<Session>('/api/auth/reset', { method: 'POST', body: { token, password }, auth: false })); },
  async logout() {
    const rt = ls.get('tessel:rt');
    setSession(null);
    if (rt) fetch(API_URL + '/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(() => {});
  },
  async update(patch: { name?: string; color?: string }) {
    const r = await api<{ user: User; accessToken: string }>('/api/auth/me', { method: 'PATCH', body: patch });
    user = r.user; access = r.accessToken; accessExp = Date.now() + 14 * 60 * 1000; ls.set('tessel:user', JSON.stringify(r.user)); emit();
  },
  user: () => user,
  signedIn: () => !!ls.get('tessel:rt'),
};

export function useUser() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return user;
}

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

let uploadsOn: Promise<boolean> | null = null;
/** Whether the server can sign photo uploads (Cloudinary is set up). */
export const uploadsEnabled = () => (uploadsOn ??= api<{ enabled: boolean }>('/api/uploads/status', { auth: false }).then((r) => r.enabled).catch(() => false));

/** Sends a photo straight to Cloudinary with a signature from our server, and returns a fast, resized link to it. */
export async function uploadImage(file: Blob): Promise<string> {
  const s = await api<{ cloud: string; apiKey: string; folder: string; timestamp: number; signature: string }>('/api/uploads/sign', { method: 'POST', body: {} });
  const form = new FormData();
  form.append('file', file); form.append('api_key', s.apiKey); form.append('timestamp', String(s.timestamp));
  form.append('folder', s.folder); form.append('signature', s.signature);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${s.cloud}/image/upload`, { method: 'POST', body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.secure_url) throw new ApiError(r.status, data?.error?.message || 'The photo couldn’t be uploaded.');
  return String(data.secure_url).replace('/upload/', '/upload/f_auto,q_auto,c_limit,w_1600/');
}
