# Code walkthrough (read this to understand, not just run)

## Request journey (follow one SOS from tap to guardian)
1. `frontend/src/pages/Sos.jsx` — the button starts a 3-second countdown, then `send()` asks the browser for a position
   (`getCurrentPosition`) and builds `{ clientId, lat, lng, accuracyM, triggeredAt }`. `clientId` is a random UUID.
2. `frontend/src/lib/sosQueue.js` — `sendSos()` POSTs it. If the network fails, `enqueue()` keeps it in `localStorage` and
   the screen shows **NOT SENT**. `flushQueue()` retries every few seconds.
3. `backend/src/app.js` → `routes/sos.js` — `authenticate` checks the token, `requireRole('child')` checks the role.
4. `routes/sos.js` inserts the alert with `ON CONFLICT (child_id, client_id) DO NOTHING`. A retry therefore cannot create a
   second alert (idempotency). It then finds recipients (active guardians + the child's emergency contacts) and calls `notify()`.
5. `lib/notify.js` inserts a row into `notifications`; a unique index on `(recipient_id, dedupe_key)` blocks duplicates.
6. The guardian's browser polls `GET /api/notifications` (`components/Layout.jsx`), shows the red bar, and `AlertDetail.jsx`
   loads `GET /api/sos/:id`, which writes an audit row because someone other than the child looked at a location.

## Backend files (`backend/src`)
| File | What it does |
|---|---|
| `config.js` | all settings and thresholds, read from environment variables; refuses weak secrets in production |
| `sql/schema.sql` | every table, foreign key, index and the audit-log trigger; run by `migrate.js` |
| `db.js` | connection pool and `withTransaction()` |
| `middleware/auth.js` | `authenticate` (verify JWT, reload user), `requireRole`, `wrap` (async error forwarding) |
| `middleware/error.js` | turns errors into safe JSON; never leaks stack traces |
| `lib/access.js` | the single place that answers "may this guardian see this child's data?" |
| `lib/crypto.js` | AES-256-GCM for reports; SHA-256 for token hashing |
| `lib/tokens.js` | JWT access tokens and rotating refresh tokens |
| `routes/zones.js` | zones, and **`processReading()`**, the geofence validation algorithm |
| `jobs/retention.js` | deletes expired data; the only code allowed to delete audit rows |
| `seed.js` | demo accounts |

### The geofence algorithm (`processReading` in `routes/zones.js`)
1. Reading less accurate than 100 m → ignored.
2. No confirmed state yet → store it as the **baseline**, send no alert.
3. Same as confirmed state → clear any pending candidate.
4. Different → count consecutive readings; confirm only when the count reaches 2 **and** 15 s have passed.
5. On confirmation → write a `location_events` row, then notify guardians unless a notified event of the same type exists inside the cooldown, or the child switched zone sharing off.

## Frontend files (`frontend/src`)
| File | What it does |
|---|---|
| `lib/api.js` | `fetch` wrapper; keeps the access token in memory; on `token_expired` refreshes once and retries |
| `auth.jsx` | login state; restores the session from the refresh cookie on page load |
| `components/Geofence.jsx` | runs on the child's device: watches position, compares to zones with the haversine formula (`lib/geo.js`), sends inside/outside only |
| `components/Layout.jsx` | navigation per role, notification polling, urgent banner, retries queued SOS |
| `components/MapView.jsx` | Leaflet map with OpenStreetMap tiles |
| `pages/*` | one file per screen (child, guardian, admin) |

## Common errors and fixes
| Symptom | Cause and fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running. Start it (`docker compose up -d`) |
| `password authentication failed for user "safezone"` | `DATABASE_URL` in `backend/.env` does not match your database user/password |
| `relation "users" does not exist` | the schema was not created; start the API once or run `npm --prefix backend run migrate` |
| Blank page, requests to `/api` fail with 404 | start the API too (`npm run dev:api`); Vite proxies `/api` to port 4000 |
| Logged out on every refresh | the API and web app are on different origins; use the Vite proxy (default) so the refresh cookie is first-party |
| Map is grey/empty | no internet access to `tile.openstreetmap.org`, or an ad blocker; zones still work |
| "Location permission is off" | allow location for the site in the browser; `localhost` counts as secure, a plain `http://192.168…` address does **not** (GPS needs HTTPS) |
| Zone alerts never arrive in test mode | zone checking must be ON, a position must be placed on the map, and the position must cross a zone edge; wait about 15 s |
| `429 Too many requests` | rate limit hit; wait, or raise `AUTH_RATE_LIMIT` / `API_RATE_LIMIT` for development |
| Tests: `database "safezone_test" does not exist` | `createdb -O safezone safezone_test` |
