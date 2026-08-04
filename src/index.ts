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

interface Comment {
    id: string;
    // Owner id. For photo threads this is the photo id (kept as `photoId` for backward
    // compatibility with the initial deploy). For style-guide threads it's the thread id.
    photoId: string;
    parentId: string | null; // null = top-level, otherwise the id of the parent comment (one level of nesting)
    author: string;         // "Brendan" | "Jessica" | "Marcela"
    body: string;
    createdAt: string;
}

const PHOTOS_INDEX_KEY = "_photos_index.json";
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_COMMENT_LENGTH = 2000;
const ALLOWED_AUTHORS = ["Brendan", "Jessica", "Marcela"];
const ALERT_RECIPIENTS = ["brendo@outlook.com", "brendanterence@gmail.com"];
const ALERT_FROM = "alerts@brendoslife.com";
const ALERT_FROM_NAME = "Waters Edge";

// Thread ids for the style guide must be lowercased and dash-separated. We restrict the
// character set to a small allowlist so R2 keys stay clean and predictable.
const THREAD_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
function threadKey(threadId: string): string {
    return `threads/${threadId}.json`;
}
async function getThreadComments(bucket: R2Bucket, threadId: string): Promise<Comment[]> {
    const obj = await bucket.get(threadKey(threadId));
    if (!obj) return [];
    const text = await obj.text();
    try { return JSON.parse(text) as Comment[]; } catch { return []; }
}
async function saveThreadComments(bucket: R2Bucket, threadId: string, comments: Comment[]): Promise<void> {
    await bucket.put(threadKey(threadId), JSON.stringify(comments), {
        httpMetadata: { contentType: "application/json" },
    });
}

function commentsKey(photoId: string): string {
    return `comments/${photoId}.json`;
}

async function getComments(bucket: R2Bucket, photoId: string): Promise<Comment[]> {
    const obj = await bucket.get(commentsKey(photoId));
    if (!obj) return [];
    const text = await obj.text();
    try {
        return JSON.parse(text) as Comment[];
    } catch {
        return [];
    }
}

async function saveComments(bucket: R2Bucket, photoId: string, comments: Comment[]): Promise<void> {
    await bucket.put(commentsKey(photoId), JSON.stringify(comments), {
        httpMetadata: { contentType: "application/json" },
    });
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Fire-and-forget email via Cloudflare MailChannels. Never blocks the response — the caller
// wraps this in ctx.waitUntil so a slow or failing send doesn't hurt the user's request.
async function sendAlert(subject: string, textBody: string, htmlBody: string): Promise<void> {
    try {
        const payload = {
            personalizations: [
                {
                    to: ALERT_RECIPIENTS.map((email) => ({ email })),
                },
            ],
            from: { email: ALERT_FROM, name: ALERT_FROM_NAME },
            subject,
            content: [
                { type: "text/plain", value: textBody },
                { type: "text/html", value: htmlBody },
            ],
        };
        const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            // Best-effort logging; observability enabled in wrangler.jsonc
            console.warn("MailChannels send failed", res.status, await res.text());
        }
    } catch (err) {
        console.warn("MailChannels send threw", err);
    }
}

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
    ctx: ExecutionContext,
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

  // POST /api/photos/upload — upload a photo (open)
  if (pathname === "/api/photos/upload" && request.method === "POST") {
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

      // Fire-and-forget email alert to Brendan.
      const uploadedByLabel = uploadedBy || "(anonymous)";
      const captionLine = caption ? `Caption: ${caption}\n` : "";
      const photoUrl = `https://brendoslife.com/watersedge/photos`;
      const alertText =
          `A new photo was uploaded to the Waters Edge photo library.\n\n` +
          `Uploaded by: ${uploadedByLabel}\n` +
          captionLine +
          `File: ${file.name}\n` +
          `View: ${photoUrl}\n`;
      const alertHtml =
          `<p>A new photo was uploaded to the <strong>Waters Edge</strong> photo library.</p>` +
          `<p><strong>Uploaded by:</strong> ${escapeHtml(uploadedByLabel)}<br>` +
          (caption ? `<strong>Caption:</strong> ${escapeHtml(caption)}<br>` : "") +
          `<strong>File:</strong> ${escapeHtml(file.name)}</p>` +
          `<p><a href="${photoUrl}">Open the photo library</a></p>`;
      ctx.waitUntil(sendAlert(`New Waters Edge photo from ${uploadedByLabel}`, alertText, alertHtml));

      return jsonResponse({ success: true, photo: meta }, 201);
  }

  // GET /api/photos/:id/comments — list comments for a photo
  {
      const commentsMatch = pathname.match(/^\/api\/photos\/([^/]+)\/comments$/);
      if (commentsMatch && request.method === "GET") {
          const photoId = commentsMatch[1];
          const index = await getPhotosIndex(bucket);
          if (!index.find((p) => p.id === photoId)) {
              return jsonResponse({ error: "Photo not found" }, 404);
          }
          const comments = await getComments(bucket, photoId);
          // Sort oldest first for natural reading order
          const sorted = [...comments].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
          return jsonResponse(sorted);
      }

      // POST /api/photos/:id/comments — add a comment (optionally a reply)
      if (commentsMatch && request.method === "POST") {
          const photoId = commentsMatch[1];
          const index = await getPhotosIndex(bucket);
          const photo = index.find((p) => p.id === photoId);
          if (!photo) return jsonResponse({ error: "Photo not found" }, 404);

          let payload: { author?: string; body?: string; parentId?: string | null };
          try {
              payload = await request.json();
          } catch {
              return jsonResponse({ error: "Invalid JSON" }, 400);
          }

          const author = (payload.author || "").trim();
          const body = (payload.body || "").trim();
          const parentId = payload.parentId || null;

          if (!ALLOWED_AUTHORS.includes(author)) {
              return jsonResponse({ error: "Please choose Brendan, Jessica, or Marcela." }, 400);
          }
          if (!body) {
              return jsonResponse({ error: "Comment cannot be empty." }, 400);
          }
          if (body.length > MAX_COMMENT_LENGTH) {
              return jsonResponse({ error: `Comment too long. Max ${MAX_COMMENT_LENGTH} characters.` }, 400);
          }

          const existing = await getComments(bucket, photoId);

          // If parentId provided, it must reference an existing top-level comment on THIS photo.
          // We enforce one level of nesting: parents can't themselves have a parentId.
          let normalizedParentId: string | null = null;
          if (parentId) {
              const parent = existing.find((c) => c.id === parentId);
              if (!parent) return jsonResponse({ error: "Parent comment not found." }, 400);
              if (parent.parentId) {
                  // Flatten: reply-to-a-reply attaches to the top-level parent instead.
                  normalizedParentId = parent.parentId;
              } else {
                  normalizedParentId = parent.id;
              }
          }

          const comment: Comment = {
              id: generateId(),
              photoId,
              parentId: normalizedParentId,
              author,
              body,
              createdAt: new Date().toISOString(),
          };

          existing.push(comment);
          await saveComments(bucket, photoId, existing);

          // Fire-and-forget email alert.
          const photoLabel = photo.caption || photo.filename || photo.id;
          const kind = normalizedParentId ? "reply" : "comment";
          const photoUrl = `https://brendoslife.com/watersedge/photos`;
          const alertText =
              `${author} posted a new ${kind} on a Waters Edge photo.\n\n` +
              `Photo: ${photoLabel}\n` +
              `${author}: ${body}\n\n` +
              `View: ${photoUrl}\n`;
          const alertHtml =
              `<p><strong>${escapeHtml(author)}</strong> posted a new ${kind} on a Waters Edge photo.</p>` +
              `<p><strong>Photo:</strong> ${escapeHtml(photoLabel)}</p>` +
              `<blockquote style="border-left:3px solid #C4973B;margin:0;padding:6px 12px;color:#0A1628;background:#FBF9F4;">` +
              escapeHtml(body).replace(/\n/g, "<br>") +
              `</blockquote>` +
              `<p><a href="${photoUrl}">Open the photo library</a></p>`;
          ctx.waitUntil(
              sendAlert(
                  `New Waters Edge ${kind} from ${author}`,
                  alertText,
                  alertHtml
              )
          );

          return jsonResponse({ success: true, comment }, 201);
      }
  }

  // DELETE /api/photos/:id — delete a photo (open)
  if (pathname.startsWith("/api/photos/") && request.method === "DELETE") {
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
// Generic comment threads (for the style guide, keyed by thread id)
// ---------------------------------------------------------------------------

async function handleThreadsApi(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    pathname: string
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const bucket = env.PHOTOS_BUCKET;

    // POST /api/threads/counts — batch count lookup: body { ids: string[] } -> { id: count }
    if (pathname === "/api/threads/counts" && request.method === "POST") {
        let body: { ids?: string[] };
        try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
        const ids = Array.isArray(body.ids) ? body.ids : [];
        const valid = ids.filter((id) => typeof id === "string" && THREAD_ID_RE.test(id)).slice(0, 200);
        const results = await Promise.all(
            valid.map(async (id) => [id, (await getThreadComments(bucket, id)).length] as const)
        );
        const out: Record<string, number> = {};
        results.forEach(([id, n]) => { out[id] = n; });
        return jsonResponse(out);
    }

    // /api/threads/:id/comments
    const match = pathname.match(/^\/api\/threads\/([^/]+)\/comments$/);
    if (!match) return jsonResponse({ error: "Not found" }, 404);
    const threadId = match[1];
    if (!THREAD_ID_RE.test(threadId)) {
        return jsonResponse({ error: "Invalid thread id" }, 400);
    }

    if (request.method === "GET") {
        const comments = await getThreadComments(bucket, threadId);
        const sorted = [...comments].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        return jsonResponse(sorted);
    }

    if (request.method === "POST") {
        let payload: { author?: string; body?: string; parentId?: string | null; context?: string };
        try { payload = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

        const author = (payload.author || "").trim();
        const body = (payload.body || "").trim();
        const parentId = payload.parentId || null;
        // Optional human-readable label for the thread, provided by the frontend for the alert email.
        const contextLabel = (payload.context || "").trim().slice(0, 200);

        if (!ALLOWED_AUTHORS.includes(author)) {
            return jsonResponse({ error: "Please choose Brendan, Jessica, or Marcela." }, 400);
        }
        if (!body) {
            return jsonResponse({ error: "Comment cannot be empty." }, 400);
        }
        if (body.length > MAX_COMMENT_LENGTH) {
            return jsonResponse({ error: `Comment too long. Max ${MAX_COMMENT_LENGTH} characters.` }, 400);
        }

        const existing = await getThreadComments(bucket, threadId);

        let normalizedParentId: string | null = null;
        if (parentId) {
            const parent = existing.find((c) => c.id === parentId);
            if (!parent) return jsonResponse({ error: "Parent comment not found." }, 400);
            normalizedParentId = parent.parentId ? parent.parentId : parent.id;
        }

        const comment: Comment = {
            id: generateId(),
            photoId: threadId, // owner id, reusing the field name
            parentId: normalizedParentId,
            author,
            body,
            createdAt: new Date().toISOString(),
        };
        existing.push(comment);
        await saveThreadComments(bucket, threadId, existing);

        const label = contextLabel || threadId;
        const kind = normalizedParentId ? "reply" : "comment";
        const pageUrl = `https://brendoslife.com/watersedge/style#thread-${threadId}`;
        const alertText =
            `${author} posted a new ${kind} on the Waters Edge Style Guide.\n\n` +
            `Section: ${label}\n` +
            `${author}: ${body}\n\n` +
            `View: ${pageUrl}\n`;
        const alertHtml =
            `<p><strong>${escapeHtml(author)}</strong> posted a new ${kind} on the <strong>Waters Edge Style Guide</strong>.</p>` +
            `<p><strong>Section:</strong> ${escapeHtml(label)}</p>` +
            `<blockquote style="border-left:3px solid #C4973B;margin:0;padding:6px 12px;color:#0A1628;background:#FBF9F4;">` +
            escapeHtml(body).replace(/\n/g, "<br>") +
            `</blockquote>` +
            `<p><a href="${pageUrl}">Open the style guide</a></p>`;
        ctx.waitUntil(
            sendAlert(`New Style Guide ${kind} from ${author} — ${label}`, alertText, alertHtml)
        );

        return jsonResponse({ success: true, comment }, 201);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
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
              return handlePhotosApi(request, env, ctx, pathname);
      }

      // 1b. Generic comment thread routes (style guide, future pages)
      if (pathname.startsWith("/api/threads")) {
              return handleThreadsApi(request, env, ctx, pathname);
      }

      // 2. Basic Auth for protected paths
      const area = findProtectedArea(pathname);
          if (area) {
                  const authorized = await isAuthorized(request, area, env);
                  if (!authorized) return unauthorized(area.realm);
          }

      // 3. Fetch the static asset.
      // NOTE: do NOT rewrite /watersedge/ to /watersedge/index.html here.
      // The assets binding's default html_handling ("auto-trailing-slash")
      // already serves watersedge/index.html for /watersedge/ — and it
      // 307-redirects any explicit .../index.html request BACK to the
      // directory URL, so rewriting causes an infinite redirect loop.
      // Extensionless pages (/watersedge/style, /watersedge/photos) are
      // likewise resolved to their .html files automatically.
      const assetResponse = await env.ASSETS.fetch(request);

      // 4. Only transform HTML responses. Pass everything else through unchanged.
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

      // 5. Add X-Robots-Tag to every response (defense in depth on the noindex meta).
      const headers = new Headers(response.headers);
          headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");

      return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers,
      });
    },
} satisfies ExportedHandler<Env>;
