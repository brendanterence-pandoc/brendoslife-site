# Deployment Instructions — Waters Edge Update

**Branch:** `update/watersedge-style-photos-2026-08-02`
**PR:** https://github.com/brendanterence-pandoc/brendoslife-site/pull/5

---

## Before You Deploy: Cloudflare Setup (5 minutes)

You need to create an R2 bucket and set a secret in your Cloudflare account. Run these commands from your local machine (where you're already authenticated with Wrangler):

### Step 1: Create the R2 Bucket

```bash
npx wrangler r2 bucket create brendoslife-photos
```

This creates the storage bucket that the photo library uses. It's free for the first 10GB.

### Step 2: Set the Photo Upload Password Secret

```bash
npx wrangler secret put PHOTOS_PASSWORD
```

When prompted, enter: `WatersEdge`

This is the shared password that Brendan, Marcela, or the designer will use to upload photos.

### Step 3: Deploy

```bash
git checkout update/watersedge-style-photos-2026-08-02
npx wrangler deploy
```

Or merge the PR to `main` first and deploy from there:

```bash
gh pr merge 5 --squash
git checkout main && git pull
npx wrangler deploy
```

---

## What Changed

| Change | URL | Description |
|--------|-----|-------------|
| New page | `/watersedge` | Waters Edge project hub (landing page) |
| New page | `/watersedge/style` | Tailored Colonial style guide (verbatim) |
| New page | `/watersedge/photos` | Photo library with upload + gallery |
| Hero update | `/` (main page) | Waters Edge link replaces Icon Medical |
| Removed | `/icon` | Icon Medical page and assets deleted |
| API | `/api/photos/*` | Backend for photo upload/list/serve/delete |

---

## Photo Library Details

- **Upload password:** `WatersEdge`
- **Storage:** Cloudflare R2 (persistent, survives redeploys)
- **Max file size:** 15MB per photo
- **Accepted formats:** JPG, PNG, HEIC
- **How it works:** Photos are stored in the R2 bucket `brendoslife-photos`. An index file tracks metadata (captions, upload dates, who uploaded). The gallery loads newest-first and clicking opens a full-size lightbox.

---

## Files Modified/Added

```
Modified:
  public/index.html              — Replaced Icon Medical with Waters Edge link
  src/index.ts                   — Added photo API, Waters Edge routing, nav link
  wrangler.jsonc                 — Added R2 binding, run_worker_first routes
  worker-configuration.d.ts      — Updated Env types

Added:
  public/watersedge/index.html   — Waters Edge hub page
  public/watersedge/style.html   — Style guide (self-contained)
  public/watersedge/photos.html  — Photo library frontend
  public/watersedge/icon-lakewoodranch.png     — 256px optimized icon (14KB)
  public/watersedge/icon-lakewoodranch-sm.png  — 76px hero icon (2KB)

Deleted:
  index.ts                       — Unused duplicate entry point
  public/icon-palm.png           — Icon Medical asset
  public/icon/index.html         — Icon Medical page
```

---

## Cost

- **R2 storage:** Free tier includes 10GB storage + 10M reads/month. Photos will stay well within this.
- **Workers:** No additional cost (same worker, same plan).
