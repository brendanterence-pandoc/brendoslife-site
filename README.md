# brendoslife-site

Personal site for Brendan O'Connor — deployed on **Cloudflare Workers** with static assets served via Workers Assets.

## Project structure

```
brendoslife-site/
├── public/               # Static assets (HTML, CSS, JS, images)
│   └── index.html        # Current live page (Marcela Pool Loan ledger)
├── src/
│   └── index.ts          # Cloudflare Worker entry point
├── wrangler.jsonc         # Wrangler / Workers configuration
├── package.json
├── tsconfig.json
└── worker-configuration.d.ts   # Auto-generated env types
```

## Quick start

```bash
# Install dependencies
npm install

# Local dev (hot-reload, assets served from public/)
npm run dev

# Deploy to Cloudflare Workers
npm run deploy
# or: npx wrangler deploy
```

> **Prerequisite:** You must be authenticated with Wrangler (`npx wrangler login`) and have a Cloudflare account before deploying.

## How it works

- **Workers Assets** (`public/` directory) hosts all static files and serves them at the edge globally.
- **`src/index.ts`** is the Worker script. It currently passes every request straight through to the static asset binding (`env.ASSETS`), but is structured to accept future server-side logic — API routes, KV reads, D1 queries, auth middleware, etc.
- **`wrangler.jsonc`** wires everything together. Commented-out stubs for KV, D1, and R2 bindings are included for easy future expansion.

## Adding server-side features

Open `src/index.ts` and add route handlers before the `env.ASSETS.fetch(request)` fallthrough:

```typescript
if (url.pathname.startsWith('/api/')) {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

Then add the corresponding bindings in `wrangler.jsonc` and regenerate types with `npm run cf-typegen`.
