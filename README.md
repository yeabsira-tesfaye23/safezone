# SafeZone

A privacy-preserving, geofencing-based safety web app for minors, their guardians and safety administrators.
**React** (Vite) + **Node.js / Express** + **PostgreSQL**, with **OpenStreetMap** maps (Leaflet).

> SafeZone raises alerts from places you define and from buttons the young person presses. It **cannot detect abuse or
> confirm a crime**, and it never labels anyone as an offender. It does not replace local emergency services.
> This is a university project: use **test accounts and simulated locations only**.

## Live deployment

SafeZone is deployed and running online: **https://safezone-j80l.onrender.com**

| Part | Where it runs |
|---|---|
| Web app and API (one Node.js service serving the built React app) | Render, free web service (Frankfurt) |
| Database | Neon, free serverless PostgreSQL |
| Transactional email (account confirmation, password reset) | Brevo HTTPS API |
| Source code | This GitHub repository; Render redeploys when `main` is updated |

Notes for anyone trying the live site:
- The free Render service sleeps when idle, so the first request after a pause can take about a minute.
- New accounts must confirm their email address through a link before they can sign in. Passwords need at least 8 characters,
  including an upper-case letter, a lower-case letter, a number and a special character.
- Use **test data and simulated locations only**. SafeZone is a student project and has not been evaluated with real users.
- The browser must allow location access for SOS to attach a position, and the page must be open for zone checking to work.
- Use a separate browser (or a private window) for each account. The sign-in cookie is shared by all tabs of one browser,
  so signing in as a second user in the same browser replaces the first.

### Settings used in production (names only; keep the values secret)

`DATABASE_URL`, `JWT_SECRET`, `REPORT_ENCRYPTION_KEY`, `COOKIE_SECURE=true`, `NODE_ENV=production`, `FRONTEND_ORIGIN` (the live URL above),
`REQUIRE_EMAIL_VERIFICATION`, `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME`. See `backend/.env.example` for what each one does.
Never commit real values to the repository.

## Run it on your own computer (no database or Docker to install)

Requirement: **Node.js 20 or newer** (https://nodejs.org, LTS).

**Windows:** double-click **`start.bat`**. **macOS/Linux:** run `./start.sh`.
The first run installs the backend (about a minute, needs internet), then opens **http://localhost:4000**.

Do **not** open `frontend/index.html` by double-clicking it: browsers refuse to run it as a file, and the page stays blank.
SafeZone must be opened through its server at http://localhost:4000.

SafeZone includes a **built-in PostgreSQL database** (PGlite), stored in `backend/data/`. Demo accounts are created
automatically on the first run (password for all: `SafeZone#Demo2026`):
`child@safezone.test`, `guardian@safezone.test`, `admin@safezone.test`. To reset everything, stop the server and delete `backend/data/`.

**Using a separate PostgreSQL server instead** (optional): copy `backend/.env.example` to `backend/.env`, uncomment `DATABASE_URL`,
then `docker compose up -d` (or your own PostgreSQL) and `npm run seed`.

**Developing the front end** (hot reload): `npm run install:all`, then `npm run dev:api` and `npm run dev:web` (app on http://localhost:5173).
After changing the front end, run `npm run build` so the server (port 4000) serves the new version.

**Try it in 2 minutes:** open two browser windows (one normal, one private). Sign in as the child in one and the
guardian in the other. As the child, open *My zones*, turn on zone checking, choose **Test mode**, click inside the
"School (demo)" circle, then outside it, then inside again. After ~15 s of consistent readings the guardian gets a routine
alert. Then press **SOS** as the child and watch the urgent alert appear for the guardian.

## Production-style run (one origin)

```bash
npm run build && NODE_ENV=production JWT_SECRET=<32+ chars> REPORT_ENCRYPTION_KEY=$(openssl rand -hex 32) COOKIE_SECURE=true npm start
```
The API then serves the built React app. Put it behind HTTPS (a reverse proxy). The app refuses to start in production with default secrets.

## Tests

```bash
npm run test          # 37 API tests (run on a PostgreSQL `safezone_test` database; they also pass on the built-in database) + 6 screen-render tests
```
Create the test database once: `createdb -O safezone safezone_test`. Tests use their own database and wipe it.

## How the requirements are met

| Requirement | Where |
|---|---|
| Roles: child, guardian, admin | `backend/src/middleware/auth.js` (`requireRole`), `lib/access.js` (who may see which child) |
| Child consent and guardian authorization | `routes/links.js`: a guardian sees nothing until the child accepts; either side can end it |
| Abusive-guardian safeguards | child can pause with a private reason; guardian is told it is paused; admin "Misuse signals" tab; zone changes notify the child |
| Hashing, tokens, recovery, deactivation | `routes/auth.js`, `routes/me.js`: bcrypt (cost 12), 15-min access token in memory, rotating httpOnly refresh cookie with replay detection, lockout, password reset, deactivation |
| Geofences with radius | `routes/zones.js`, `pages/GuardianZones.jsx` (100–500 m) |
| Enter/exit detection without tracking | The **phone** decides inside/outside (`components/Geofence.jsx`); only "inside/outside + accuracy" is sent |
| GPS inaccuracy and false alerts | server ignores accuracy > 100 m, needs 2 consistent readings over 15 s, first reading is a silent baseline, 5-min cooldown, unique dedupe key |
| SOS with honest status | `routes/sos.js`, `pages/Sos.jsx`: 3 s cancel countdown; "sent" only after server confirmation; offline queue shown as **NOT SENT**; call/text fallback the user sends herself |
| Incident reports | `routes/reports.js`: AES-256-GCM encrypted, private by default, optional sharing with guardians, admin opens are audited |
| Notifications | in-app, urgent vs routine styling, de-duplicated, explained, timestamped |
| Audit log | `lib/audit.js`; database trigger makes it append-only |
| Retention and deletion | `jobs/retention.js` (daily), `DELETE /api/me/data`, anonymisation after deactivation |
| No coordinates in URLs/logs/push | coordinates only in POST bodies; request logger omits bodies and query strings; notification text never contains coordinates (tested) |

## Honest limitations (put these in your report)

- **Notifications are in-app only.** Firebase push is not wired up (it needs a Firebase project and a mobile/service-worker client). The app polls every 6 s and can show a browser pop-up if the tab is open. A closed browser tab receives nothing.
- **A browser cannot check geofences in the background** the way a native app can. Zone checking works while the page is open. For true background geofencing, build the Flutter client from the design document against this same API.
- Position data from a browser can be spoofed; the server trusts the child's device for "inside/outside". Test mode is only a simulator for demos.
- Email (confirmation and password reset) is sent through Brevo when `BREVO_API_KEY` and `MAIL_FROM` are set. Without them, the message is printed to the server console, which is what happens when you run SafeZone locally.
- Guardian verification is optional (`REQUIRE_GUARDIAN_VERIFICATION=true` makes admins verify guardians first). Real identity checks are out of scope.
- Retention periods are proposals, not legal advice. Confirm legal rules for minors' data in your country.
- No test results from real users exist. Do not report usability or battery numbers you did not measure.

See `docs/WALKTHROUGH.md` for a file-by-file explanation, how to run each part, and common errors.
