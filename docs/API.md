# Tessel API

Base URL: `https://tessel-api-1gg4.onrender.com` (or `http://localhost:8787` locally).

All bodies are JSON. Errors look like `{ "error": "Readable message", "code": "machine_code" }` with a matching HTTP status.

## Authentication

Send `Authorization: Bearer <accessToken>` on every signed-in request.

- **Access tokens** are JWTs (HS256) that last 15 minutes. The web app keeps them in memory only.
- **Refresh tokens** are random 256-bit strings, stored server-side as SHA-256 hashes, valid for 30 days and **single use**: every refresh returns a new pair and retires the old token.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/signup` | `{ name, email, password }` | Password at least 8 characters. Returns `{ user, accessToken, refreshToken, expiresIn }`. |
| POST | `/api/auth/login` | `{ email, password }` | Rate limited (30 per 15 min per IP). Same response as signup. |
| POST | `/api/auth/refresh` | `{ refreshToken }` | Rotates the refresh token. |
| POST | `/api/auth/logout` | `{ refreshToken }` | Ends that session. |
| GET | `/api/auth/me` | | Current user. |
| PATCH | `/api/auth/me` | `{ name?, color? }` | Returns a fresh access token with the new name. |

## Boards

Roles: `owner`, `editor`, `viewer`. Every board has a share link token `k`; with link access set to `view` or `edit`, adding `?k=<token>` to board requests grants that role (edit requires being signed in).

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/templates` | anyone | Template list. |
| GET | `/api/boards` | signed in | Boards you own or are a member of, newest first. |
| POST | `/api/boards` | signed in | `{ title?, template? }`. Templates are drawn into the board's CRDT on the server. |
| GET | `/api/boards/:id` | any role | Board details, your role, members, thumbnail (SVG). |
| PATCH | `/api/boards/:id` | editor (title), owner (`linkAccess`) | `{ title?, linkAccess?: 'none' \| 'view' \| 'edit' }` |
| POST | `/api/boards/:id/join` | signed in | `{ k }`. Adds you as a member through the share link. |
| POST | `/api/boards/:id/link/reset` | owner | New share link; the old one stops working at once. |
| POST | `/api/boards/:id/members` | owner | `{ email, role }`. Invite an existing user; sends them a notification. |
| PATCH | `/api/boards/:id/members/:userId` | owner | `{ role }` |
| DELETE | `/api/boards/:id/members/:userId` | owner, or yourself (leave) | |
| POST | `/api/boards/:id/star` | any role | Toggle star. |
| POST | `/api/boards/:id/duplicate` | any role | Copy into your boards. |
| DELETE | `/api/boards/:id` | owner | Moves to trash. `?forever=1` deletes a trashed board and its history. |
| POST | `/api/boards/:id/restore` | owner | Out of trash. |

Changing roles or link access immediately re-checks everyone connected to the board; people who lost access are disconnected.

## Version history

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/boards/:id/versions` | any role | Named and automatic versions (one every 10 minutes of editing, last 40 kept). |
| POST | `/api/boards/:id/versions` | editor | `{ name }`. Save the current state. |
| GET | `/api/boards/:id/versions/:vid` | any role | The version's shapes, for previews. |
| POST | `/api/boards/:id/versions/:vid/restore` | editor | Saves a "Before restoring" version first, then replaces the board for everyone live. |

## Comments

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/boards/:id/comments` | signed-in member | All threads with authors. |
| POST | `/api/boards/:id/comments` | signed-in member (viewers too) | `{ x, y, shapeId?, ox?, oy?, text, mentions? }`. A pin with `shapeId` follows that shape. |
| POST | `/api/boards/:id/comments/:cid/replies` | signed-in member | `{ text, mentions? }` |
| PATCH | `/api/boards/:id/comments/:cid` | signed-in member | `{ resolved? , x?, y?, shapeId?, ox?, oy? }` |
| PATCH | `/api/boards/:id/comments/:cid/replies/:mid` | author | `{ text }` |
| DELETE | `/api/boards/:id/comments/:cid` | thread starter or editor | |
| DELETE | `/api/boards/:id/comments/:cid/replies/:mid` | author or owner | |

`mentions` are user ids. Only people on the board can be mentioned; each gets a notification and an email (Resend). Other people in the thread get a reply notification. Every change sends `{ "type": "comments" }` over the board's WebSocket so open boards refresh.

## AI

`POST /api/boards/:id/ai` (editor, 25 requests per 10 minutes per user)

| `action` | Input | Result |
|---|---|---|
| `organise` | `ids` (3+ sticky notes) | Notes grouped into titled frames. Selected frames left empty are replaced. |
| `summarise` | `ids?` (default: whole board) | A summary note next to the content. |
| `diagram` | `prompt`, `at?` | A laid-out flowchart (start, steps, decisions, ends, labelled branches), placed in free space. |
| `expand` | `ids` (one note) | Five new idea notes placed in free spots around it, linked by arrows. |

Responses: `{ ok, ids, message }`. The model is Gemini with a JSON response schema, so output is always structured; if the configured model is retired the server picks the newest available Flash model. Every `organise` saves a version first.

## Photos

| Method | Path | Notes |
|---|---|---|
| GET | `/api/uploads/status` | `{ enabled }` |
| POST | `/api/uploads/sign` | Signed in. Returns `{ cloud, apiKey, folder, timestamp, signature }` for a direct browser upload to Cloudinary. The secret never leaves the server. |

## Notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/api/notifications` | Latest 50 and the unread count. |
| POST | `/api/notifications/read` | `{ ids? }`. Marks some or all as read. |

## Live sync: `wss://…/ws/:boardId`

1. Open the socket and send one **text** frame: `{ "token"?: accessToken, "k"?: linkToken, "name"?: guestName }`. Tokens travel in the first frame, never in the URL, so they don't end up in logs.
2. The server replies `{ "type": "ready", "role", "now", "user" }` (or `{ "type": "denied", "reason" }` and closes with code 4403/4401). `now` lets clients line up shared timers with the server clock.
3. After that, **binary** frames use the standard Yjs protocols: `0` = sync (step 1, step 2, update), `1` = awareness (cursors, selections, viewport, reactions, cursor chat, presenting).

Viewers receive everything but the server drops their document updates. The special board id `lobby` is the public board on the landing page: anyone can join, nothing is saved, and it is capped at 250 shapes.

Server-side text messages: `{ "type": "role", "role" }` when your access changes, and `{ "type": "comments" }` when comments change.
