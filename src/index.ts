// brendoslife-site Worker
//
// Responsibilities:
//   1. HTTP Basic Auth for protected areas (Marcela, Media, plus any future trackers).
//   2. Photo Library API for Waters Edge (/api/photos/*) with R2 storage.
//   3. HTMLRewriter injects a shared site header (brand + nav) into every HTML page.
//   4. HTMLRewriter injects a noindex meta tag into every HTML page.
//   5. Response sets X-Robots-Tag: noindex, nofollow, noarchive on every response.

export interface Env {
  ASSETS: Fetcher;
  MARCELA_USERNAME: string;
  MARCELA_PASSWORD: string;
  MEDIA_USERNAME: string;
  MEDIA_PASSWORD: string;
  PHOTOS_BUCKET: R2Bucket;
  PHOTOS_PASSWORD: string;
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
// Photo Library API (R2-backed)
// ---------------------------------------------------------------------------

interface PhotoMeta {
  id: string;
  filename: string;
  caption: string;
  uploadedBy: string;
  uploadedAt: string;
  contentType: string;
  size: number;
  thumbKey: string;
  fullKey: string;
}

const PHOTOS_INDEX_KEY = "_photos_index.json";
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Upload-Password",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

async function getPhotosIndex(bucket: R2Bucket): Promise<PhotoMeta[]> {
  const obj = await bucket.get(PHOTOS_INDEX_KEY);
  if (!obj) return [];
  const text = await obj.text();
  try {
    return JSON.parse(text) as PhotoMeta[];
  } catch {
    return [];
  }
}

async function savePhotosIndex(bucket: R2Bucket, index: PhotoMeta[]): Promise<void> {
  await bucket.put(PHOTOS_INDEX_KEY, JSON.stringify(index), {
    httpMetadata: { contentType: "application/json" },
  });
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function handlePhotosApi(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response> {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const bucket = env.PHOTOS_BUCKET;

  // GET /api/photos — list all photos
  if (pathname === "/api/photos" && request.method === "GET") {
    const index = await getPhotosIndex(bucket);
    // Return newest first
    const sorted = [...index].sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
    return jsonResponse(sorted);
  }

  // GET /api/photos/thumb/:id — serve thumbnail
  if (pathname.startsWith("/api/photos/thumb/") && request.method === "GET") {
    const id = pathname.slice("/api/photos/thumb/".length);
    const index = await getPhotosIndex(bucket);
    const photo = index.find((p) => p.id === id);
    if (!photo) return jsonResponse({ error: "Not found" }, 404);

    const obj = await bucket.get(photo.thumbKey);
    if (!obj) return jsonResponse({ error: "Thumbnail not found" }, 404);

    return new Response(obj.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  // GET /api/photos/full/:id — serve full-resolution image
  if (pathname.startsWith("/api/photos/full/") && request.method === "GET") {
    const id = pathname.slice("/api/photos/full/".length);
    const index = await getPhotosIndex(bucket);
    const photo = index.find((p) => p.id === id);
    if (!photo) return jsonResponse({ error: "Not found" }, 404);

    const obj = await bucket.get(photo.fullKey);
    if (!obj) return jsonResponse({ error: "Image not found" }, 404);

    return new Response(obj.body, {
      headers: {
        "Content-Type": photo.contentType,
        "Cache-Control": "public, max-age=86400",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  // POST /api/photos/upload — upload a photo (password-protected)
  if (pathname === "/api/photos/upload" && request.method === "POST") {
    const password = request.headers.get("X-Upload-Password") || "";
    const expectedPassword = env.PHOTOS_PASSWORD || "WatersEdge";

    if (!timingSafeEqual(password, expectedPassword)) {
      return jsonResponse({ error: "Incorrect password. Please try again." }, 403);
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return jsonResponse({ error: "No file provided" }, 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return jsonResponse({ error: "File too large. Maximum 15MB." }, 400);
    }

    const caption = (formData.get("caption") as string) || "";
    const uploadedBy = (formData.get("uploadedBy") as string) || "";

    // Determine content type
    let contentType = file.type || "image/jpeg";
    const lowerName = file.name.toLowerCase();

    // Convert HEIC to JPEG on the server side (basic handling)
    // Note: Full HEIC conversion requires additional libraries.
    // For now, we accept the file as-is and store it; the frontend will handle display.
    if (lowerName.endsWith(".heic") || lowerName.endsWith(".heif")) {
      contentType = "image/heic";
    }

    const id = generateId();
    const ext = contentType.includes("png") ? "png" : "jpg";
    const fullKey = `photos/full/${id}.${ext}`;
    const thumbKey = `photos/thumb/${id}.jpg`;

    // Store full-resolution image
    const arrayBuffer = await file.arrayBuffer();
    await bucket.put(fullKey, arrayBuffer, {
      httpMetadata: { contentType },
    });

    // Generate thumbnail (simple resize using canvas is not available in Workers,
    // so we store a reference and serve the full image scaled by the browser for now.
    // For a production system, you'd use Cloudflare Image Resizing or a separate transform.)
    // Store the full image also as thumb for now — the frontend will display at thumbnail size.
    await bucket.put(thumbKey, arrayBuffer, {
      httpMetadata: { contentType: "image/jpeg" },
    });

    const meta: PhotoMeta = {
      id,
      filename: file.name,
      caption,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      contentType,
      size: file.size,
      thumbKey,
      fullKey,
    };

    const index = await getPhotosIndex(bucket);
    index.push(meta);
    await savePhotosIndex(bucket, index);

    return jsonResponse({ success: true, photo: meta }, 201);
  }

  // DELETE /api/photos/:id — delete a photo (password-protected)
  if (pathname.startsWith("/api/photos/") && request.method === "DELETE") {
    const password = request.headers.get("X-Upload-Password") || "";
    const expectedPassword = env.PHOTOS_PASSWORD || "WatersEdge";

    if (!timingSafeEqual(password, expectedPassword)) {
      return jsonResponse({ error: "Incorrect password." }, 403);
    }

    const id = pathname.slice("/api/photos/".length);
    const index = await getPhotosIndex(bucket);
    const photoIdx = index.findIndex((p) => p.id === id);
    if (photoIdx === -1) return jsonResponse({ error: "Not found" }, 404);

    const photo = index[photoIdx];
    await bucket.delete(photo.fullKey);
    await bucket.delete(photo.thumbKey);
    index.splice(photoIdx, 1);
    await savePhotosIndex(bucket, index);

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Not found" }, 404);
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
    href: "/watersedge",
    label: "Waters Edge",
    isActive: (p) => p === "/watersedge" || p.startsWith("/watersedge/"),
  },
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
    let pathname = url.pathname;

    // Normalize: strip trailing slash (except root)
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    // 1. Photo Library API routes
    if (pathname.startsWith("/api/photos")) {
      return handlePhotosApi(request, env, pathname);
    }

    // 2. Basic Auth for protected paths
    const area = findProtectedArea(pathname);
    if (area) {
      const authorized = await isAuthorized(request, area, env);
      if (!authorized) return unauthorized(area.realm);
    }

    // 3. Rewrite clean URLs to actual .html files
    //    (html_handling is "none" so Assets won't do this for us)
    const rewrites: Record<string, string> = {
      "/": "/index.html",
      "/watersedge": "/watersedge/index.html",
      "/watersedge/style": "/watersedge/style.html",
      "/watersedge/photos": "/watersedge/photos.html",
      "/marcela": "/marcela/index.html",
    };

    let assetPathname: string;
    if (rewrites[pathname]) {
      // Explicit directory-index or clean-URL mapping
      assetPathname = rewrites[pathname];
    } else if (pathname.includes(".")) {
      // Path already has a file extension — serve as-is
      assetPathname = pathname;
    } else {
      // Extensionless path (e.g. /media, /plan) — try appending .html
      assetPathname = pathname + ".html";
    }

    const assetUrl = new URL(request.url);
    assetUrl.pathname = assetPathname;

    // Helper: fetch from Assets with redirect:manual to intercept 3xx
    async function fetchAsset(targetUrl: string): Promise<Response> {
      return env.ASSETS.fetch(
        new Request(targetUrl, {
          method: request.method,
          headers: request.headers,
          redirect: "manual",
        })
      );
    }

    // Helper: follow internal redirects from Assets (max 5 hops)
    async function fetchAssetResolved(targetUrl: string): Promise<Response> {
      let resp = await fetchAsset(targetUrl);
      let hops = 0;
      while (resp.status >= 300 && resp.status < 400 && hops < 5) {
        const loc = resp.headers.get("Location");
        if (!loc) break;
        const resolved = new URL(loc, targetUrl).toString();
        resp = await fetchAsset(resolved);
        hops++;
      }
      return resp;
    }

    // 4. Fetch the static asset.
    let assetResponse = await fetchAssetResolved(assetUrl.toString());

    // If the .html guess 404'd and original had no extension, try original path
    if (assetResponse.status === 404 && !pathname.includes(".") && !rewrites[pathname]) {
      const fallbackUrl = new URL(request.url);
      fallbackUrl.pathname = pathname;
      assetResponse = await fetchAssetResolved(fallbackUrl.toString());
    }

    // 5. Only transform HTML responses. Pass everything else through unchanged.
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

    // 6. Add X-Robots-Tag to every response (defense in depth on the noindex meta).
    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
