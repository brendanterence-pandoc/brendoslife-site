// brendoslife-site Worker
//
// Responsibilities:
//   1. HTTP Basic Auth for protected areas (Marcela, Media, plus any future trackers).
//   2. HTMLRewriter injects a shared site header (brand + nav) into every HTML page.
//   3. HTMLRewriter injects a noindex meta tag into every HTML page.
//   4. Response sets X-Robots-Tag: noindex, nofollow, noarchive on every response.
//
// All HTML pages get the same header from one source. To add a new tracker:
//   - Add the new page (e.g., public/family.html).
//   - Add a Cloudflare secret pair (FAMILY_USERNAME, FAMILY_PASSWORD).
//   - Add a PROTECTED_AREAS entry below.
//   - Add a NAV_LINKS entry below.
//
// No edits to individual HTML files needed for navigation.

export interface Env {
  ASSETS: Fetcher;
  MARCELA_USERNAME: string;
  MARCELA_PASSWORD: string;
  MEDIA_USERNAME: string;
  MEDIA_PASSWORD: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface ProtectedArea {
  matches: (pathname: string) => boolean;
  realm: string;
  usernameKey: keyof Env;
  passwordKey: keyof Env;
}

const PROTECTED_AREAS: ProtectedArea[] = [
  {
    matches: (p) => p === "/marcela" || p.startsWith("/marcela/"),
    realm: "Marcela Area",
    usernameKey: "MARCELA_USERNAME",
    passwordKey: "MARCELA_PASSWORD",
  },
  {
    matches: (p) =>
      p === "/media" ||
      p === "/media.html" ||
      p.startsWith("/media/"),
    realm: "Media Tracker",
    usernameKey: "MEDIA_USERNAME",
    passwordKey: "MEDIA_PASSWORD",
  },
];

function unauthorized(realm: string): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${realm}"`,
      "Content-Type": "text/plain; charset=UTF-8",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function findProtectedArea(pathname: string): ProtectedArea | undefined {
  return PROTECTED_AREAS.find((area) => area.matches(pathname));
}

async function isAuthorized(
  request: Request,
  area: ProtectedArea,
  env: Env
): Promise<boolean> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;

  const encoded = authHeader.slice(6).trim();
  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  const expectedUsername = env[area.usernameKey] as string;
  const expectedPassword = env[area.passwordKey] as string;
  if (!expectedUsername || !expectedPassword) return false;

  return (
    timingSafeEqual(username, expectedUsername) &&
    timingSafeEqual(password, expectedPassword)
  );
}

// ---------------------------------------------------------------------------
// Shared site header (single source of truth)
// ---------------------------------------------------------------------------

interface NavLink {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
}

const NAV_LINKS: NavLink[] = [
  {
    href: "/marcela",
    label: "Marcela",
    isActive: (p) => p === "/marcela" || p.startsWith("/marcela/"),
  },
  {
    href: "/media.html",
    label: "Media",
    isActive: (p) =>
      p === "/media" || p === "/media.html" || p.startsWith("/media/"),
  },
];

const SITE_HEADER_CSS = `
.brendoslife-site-header {
  position: sticky;
  top: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 32px;
  background: rgba(10, 22, 40, 0.95);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(212, 209, 202, 0.18);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  box-sizing: border-box;
}
.brendoslife-site-header .brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #f7f6f2;
  text-decoration: none;
}
.brendoslife-site-header .brand img {
  display: block;
  height: 28px;
  width: auto;
  filter: brightness(1.05);
}
.brendoslife-site-header .brand-text {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 0.92rem;
  letter-spacing: 0.22em;
  color: #c4973b;
  text-transform: uppercase;
  font-weight: 600;
}
.brendoslife-site-header .brand:hover .brand-text { color: #e3c878; }
.brendoslife-site-header nav { display: flex; gap: 26px; }
.brendoslife-site-header nav a {
  color: #f7f6f2;
  text-decoration: none;
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 500;
  padding: 6px 0;
  border-bottom: 1.5px solid transparent;
  transition: color .15s, border-color .15s;
}
.brendoslife-site-header nav a:hover { color: #c4973b; }
.brendoslife-site-header nav a.active {
  color: #c4973b;
  border-bottom-color: #c4973b;
}
@media (max-width: 600px) {
  .brendoslife-site-header { padding: 12px 18px; }
  .brendoslife-site-header nav { gap: 16px; }
  .brendoslife-site-header .brand img { height: 24px; }
  .brendoslife-site-header .brand-text { font-size: 0.78rem; letter-spacing: 0.18em; }
}
`.trim();

const NOINDEX_META = `<meta name="robots" content="noindex, nofollow, noarchive">`;

function buildSiteHeader(pathname: string): string {
  const links = NAV_LINKS.map((link) => {
    const active = link.isActive(pathname) ? ' class="active"' : "";
    return `    <a href="${link.href}"${active}>${link.label}</a>`;
  }).join("\n");

  return `<header class="brendoslife-site-header" role="banner">
  <a class="brand" href="/">
    <img src="/brendoslife-mark.png" alt="" />
    <span class="brand-text">Brendo's Life</span>
  </a>
  <nav aria-label="Site sections">
${links}
  </nav>
</header>`;
}

// ---------------------------------------------------------------------------
// HTMLRewriter handlers
// ---------------------------------------------------------------------------

class HeadInjector {
  private done = false;

  constructor(private extraHead: string) {}

  element(element: Element) {
    if (this.done) return;
    element.append(this.extraHead, { html: true });
    this.done = true;
  }
}

class BodyInjector {
  private done = false;

  constructor(private headerHtml: string) {}

  element(element: Element) {
    if (this.done) return;
    element.prepend(this.headerHtml, { html: true });
    this.done = true;
  }
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. Basic Auth for protected paths
    const area = findProtectedArea(pathname);
    if (area) {
      const authorized = await isAuthorized(request, area, env);
      if (!authorized) return unauthorized(area.realm);
    }

    // 2. Fetch the static asset
    const assetResponse = await env.ASSETS.fetch(request);

    // 3. Only transform HTML responses. Pass everything else through unchanged.
    const contentType = assetResponse.headers.get("Content-Type") || "";
    const isHtml = contentType.includes("text/html");

    let response = assetResponse;

    if (isHtml) {
      const headerHtml = buildSiteHeader(pathname);
      const headInject = `${NOINDEX_META}<style>${SITE_HEADER_CSS}</style>`;

      response = new HTMLRewriter()
        .on("head", new HeadInjector(headInject))
        .on("body", new BodyInjector(headerHtml))
        .transform(assetResponse);
    }

    // 4. Add X-Robots-Tag to every response (defense in depth on the noindex meta).
    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
