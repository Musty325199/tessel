# Tessel

A live, multiplayer whiteboard. Sticky notes, shapes, arrows, drawing and images on an infinite canvas, with everyone's cursor on screen, offline editing that merges on reconnect, and full version history.

**Live app:** https://musty325199.github.io/tessel/

## What it does

- Infinite canvas: sticky notes, text, rectangles, circles, diamonds, connected arrows, freehand pen, images and frames
- Real-time collaboration: live cursors with names, presence avatars, follow someone's view, selections, emoji reactions and cursor chat
- Works offline: every board is stored in IndexedDB and merges cleanly when you reconnect (CRDT)
- Sharing: invite by email as editor or viewer, or share a link with view or edit access; owners can revoke at any time
- Version history: automatic snapshots every 10 minutes of editing, named versions, preview and restore
- Dashboard: templates, starred boards, shared with me, trash and restore, search, notifications
- Phone first: pinch to zoom, one-finger pan, touch-sized controls; light and dark themes

## How it works

```
 Browser (React + Yjs) ──┐                     ┌── MongoDB Atlas
   IndexedDB copy        │  WebSocket (binary   │     boards, docs,
                         ├─ Yjs sync protocol) ─┤     versions, users
 Browser (React + Yjs) ──┘   Node.js server    └──
   IndexedDB copy             rooms, auth, permissions, snapshots
```

- Each board is a **Yjs CRDT document**. Edits apply locally first, so the UI never waits on the network, and concurrent edits merge without conflicts.
- The server speaks the Yjs sync and awareness protocols over WebSockets. The first frame is a JSON hello carrying the access token, so tokens never appear in URLs or logs. Viewers can read but their updates are dropped server-side.
- Saves are debounced (1.5 s, max 8 s during constant editing). Every 10 minutes of activity creates an automatic version; the last 40 are kept. Restoring a version first snapshots the current state, so restores can be undone.
- Auth: bcrypt passwords, 15-minute JWT access tokens held in memory, rotating single-use refresh tokens stored hashed (SHA-256) server-side.
- Dashboard thumbnails are SVGs drawn on the server straight from the CRDT shapes.

## Stack

React 18, TypeScript, Vite, Yjs, y-protocols, IndexedDB · Node.js, Express, ws, Zod, MongoDB · Vitest, Supertest · GitHub Actions, GitHub Pages, Render

## Run it locally

```bash
# API (in-memory storage when MONGODB_URI is not set)
cd server && npm install && npm run dev

# Web app
cd web && npm install && npx vite
```

Open http://localhost:5173. Set `VITE_API_URL` if the API runs elsewhere.

## Tests

```bash
cd server && npm test
```

Covers sign-up, sign-in and refresh-token rotation, roles and sharing, and live sync between real WebSocket clients, including a viewer whose edits must not reach anyone, and version restore.

## Deploy

- `render.yaml` creates the API on Render's free plan (set `MONGODB_URI`; `JWT_SECRET` is generated).
- `.github/workflows/ci.yml` runs the tests and publishes the web app to GitHub Pages.

Built by Musty.
