# Building Tessel: notes on the hard parts

Tessel is a multiplayer whiteboard built to run entirely on free hosting and to work well on a phone. These are the decisions that mattered and why.

## 1. Conflicts: CRDT instead of a central lock

A whiteboard has many people changing many small things at once. A server-authoritative model (send every change, wait for the server, roll back on conflict) makes the canvas feel laggy on mobile data and needs custom conflict rules.

Each board is a **Yjs document** instead. Every shape is its own `Y.Map`, so changes merge per property: if one person recolours a note while another drags it, both changes survive. Edits apply locally first and sync in the background, which also makes offline editing almost free: the doc is persisted to IndexedDB and merges on reconnect.

**Trade-off:** CRDT documents only grow. Deleted shapes leave small tombstones, which is acceptable at whiteboard scale. Snapshots for version history are full encoded states, so history storage grows with board size; only the latest 40 automatic versions are kept.

## 2. Writing the sync server instead of using a hosted service

Hosted CRDT backends cost money past their free tier and hide the interesting part. The server implements the Yjs **sync** and **awareness** protocols directly over `ws`:

- one in-memory room per open board, loaded from MongoDB on first join and unloaded 30 s after the last person leaves (after a final save);
- the first frame is a JSON hello with the access token, so tokens never sit in URLs or access logs;
- **permissions on the wire:** a viewer's sync-step-2 and update messages are dropped before they reach the doc, so read-only access can't be bypassed from the browser console;
- when sharing changes, connected sockets are re-checked and anyone who lost access is disconnected immediately;
- saves are debounced (1.5 s) with a maximum wait (8 s), so a long editing session can't go unsaved.

Render's free plan sleeps after inactivity, so the client reconnects with exponential backoff and shows the locally saved board while the server wakes.

## 3. Auth that works on iPhone

The web app (GitHub Pages) and the API (Render) are on different sites, and Safari blocks third-party cookies, so cookie sessions would break on iOS. Tessel uses short-lived JWT access tokens kept **in memory** plus long-lived **refresh tokens** that are random, stored only as SHA-256 hashes, and **rotated on every use**, so a stolen refresh token is worth one refresh. Login compares against a dummy hash for unknown emails so response time doesn't reveal which emails exist.

## 4. AI that produces layouts, not text

Language models are bad at coordinates and good at structure. Every AI action asks Gemini for **JSON matching a schema** (groups of note ids, flowchart nodes and edges, idea lists), then lays the result out in code:

- **organise** keeps every note exactly once, even if the model forgets or repeats one, and replaces selected frames that end up empty;
- **diagram** assigns rows by longest path and drops back-edges first, so loops in a process can't push nodes off the screen;
- **expand** searches outward around the source note for free spots;
- new content is shifted into empty space when it would land on existing shapes.

If Google retires the configured model, the server lists the available models and picks the newest Flash model. A version is saved before AI rearranges anything.

## 5. Text editing that matches the result

Editing happens in a `textarea` laid over a hidden copy of the same text in one CSS grid cell. The hidden copy decides the size, so the edit box wraps exactly where the finished note will. Notes and shapes grow when text overflows instead of clipping. On phones, the formatting bar moves under the top bar and the board scrolls the note above the keyboard using the Visual Viewport API.

## 6. Shared session state without new endpoints

Timer, voting and presenting reuse what already syncs:

- the **timer** is a value in the doc with an `endsAt` time; clients correct for clock skew with the server time sent in the WebSocket handshake;
- **votes** live in a map keyed by user id, so each person only ever writes their own entry and votes can't conflict;
- **presenting** is an awareness field, so it disappears automatically when the presenter disconnects.

## 7. Exports that look the same everywhere

Screenshotting the DOM differs between browsers and breaks on iOS. Exports use a dedicated canvas renderer with its own text wrapping, the app's fonts, arrow geometry, pen strokes and image cropping, capped at about 16 megapixels so phones don't run out of memory. PDF export is loaded on demand so it doesn't slow the first page load.

## Testing

- **API and permissions:** sign-up, login, refresh-token rotation, roles, link sharing, trash.
- **Real sync:** two editors and a viewer connect over WebSockets; edits reach editors, the viewer's edits reach no one, a version restore reaches everyone and is saved to the database.
- **AI:** layout functions are pure and tested directly; the endpoint is tested with a fake model.
- **Browser:** Playwright runs the built app against the real API in desktop Chrome and an iPhone viewport, including a two-person session.

## What I'd do next

- Rich text inside a note (per-word formatting) with a Yjs-backed editor
- Store photos' Cloudinary ids to clean up unused uploads
- Horizontal scaling: rooms are per process today; a Redis pub/sub layer would let several servers share a board
