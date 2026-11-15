# MedTrack

Phone-first tracker for scheduled and as-needed medications plus 0 to 10 symptom check-ins. It keeps a dated history of regimen changes, charts adherence against scores and Apple Health daily metrics, and produces a printable clinician report with CSV and JSON exports.

No tracker data belongs in this folder. It lives in the hosted database only.

## Layout

| Path | Purpose |
| --- | --- |
| `client/` | React app (Vite, Tailwind, hash routing) |
| `shared/` | Schema, schedule and analytics logic used by client and server |
| `server/core.ts` | The whole API as one portable handler, with no Node or Worker imports |
| `server/exports.ts` | CSV builders, Medisafe CSV parser, clinician report HTML |
| `server/index.ts`, `storage.ts` | Local Express and better-sqlite3 host for development |
| `../src/meds.ts` | Production host: Durable Object storage, sign-in, guess limiting |

## Develop

```bash
npm install
npm run dev          # Express + Vite on port 5000, no sign-in, local data.db
npm run check        # typecheck
```

To run the production shape locally, from the repository root (Node 22 or newer):

```bash
npx wrangler dev     # serves /meds and /meds/api with a local Durable Object
```

## Release

```bash
npm run build:site   # writes the client to ../public/meds
```

Commit `public/meds` together with the source change and push to `main`. The site workflow deploys it.

## API

Everything is under `/meds/api`. Send a `User-Agent` header, because the site challenges the default curl agent.

| Request | Purpose |
| --- | --- |
| `GET /state` | Regimen items, notes, change log, report header |
| `POST /items`, `PATCH /items/:id`, `POST /items/:id/stop`, `POST /items/:id/restart` | Add, change, stop, restart a medication or tracker |
| `GET /logs?from&to`, `POST /logs`, `POST /logs/batch`, `PATCH /logs/:id`, `DELETE /logs/:id` | Doses and ratings |
| `POST /notes`, `POST /changes` | Diary notes and manual change-log entries |
| `GET /health?from&to`, `POST /health/bulk` | Apple Health daily metrics |
| `GET /export/report.html`, `daily.csv`, `medisafe.csv`, `backup.json` | Reports and exports |
| `POST /import/medisafe`, `POST /import/backup` | Medisafe history and backup restore |

Write requests take `today` (`YYYY-MM-DD`) and `now` (`YYYY-MM-DDTHH:MM`) in the user's local time, because the server does not assume a timezone.

`PATCH /items/:id` keeps history by default: a schedule or dose change closes the old version and starts a new one from `today`, and writes a change-log entry. Send `"mode": "correct"` to fix a typo in place without a change-log entry.

## Access

The API refuses every request until a passcode is enrolled.

- Browsers sign in at `/meds/` and receive an HttpOnly session cookie scoped to `/meds`.
- Automation sends the passcode in the `X-Meds-Key` header.
- Five wrong tries lock an address out for 15 minutes, doubling on each further miss. Forty wrong tries site-wide in an hour pause all passcode checks for the rest of that hour. Signed-in devices are not affected.

### Setting or resetting the passcode

`src/meds.ts` stores the SHA-256 of a random setup key. To reset access:

1. Generate a new key: `openssl rand -hex 32`. Keep it out of the repository.
2. Put its SHA-256 in `SETUP_KEY_SHA256` in `src/meds.ts`, commit, push, and wait for the deploy.
3. `POST /meds/api/auth/enroll` with `X-Meds-Admin: <key>` and the new passcode in `X-Meds-Key` (8 to 200 characters). This signs every device out.
4. Discard the key.
