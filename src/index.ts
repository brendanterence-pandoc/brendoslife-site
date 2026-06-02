/**
 * brendoslife-site — Cloudflare Workers entry point
 *
 * Architecture:
 *   • Static assets are served from the `public/` directory via Workers Assets
 *     (configured in wrangler.jsonc under `assets.directory`).
 *   • This Worker script intercepts every request so we can add future
 *     server-side logic (API routes, KV reads, D1 queries, auth, etc.)
 *     without changing the deployment model.
 *   • For now, all requests fall through to the static asset binding.
 */

export interface Env {
  // Workers Assets binding — automatically populated by the runtime when
  // `assets.binding` is set in wrangler.jsonc.
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── Future API routes go here ──────────────────────────────────────────
    // Example:
    //   if (url.pathname.startsWith('/api/')) {
    //     return handleApi(request, env, ctx);
    //   }
    // ──────────────────────────────────────────────────────────────────────

    // Fall through to static assets (public/)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
