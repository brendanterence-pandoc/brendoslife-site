// MedTrack: private medication and symptom tracker at /meds.
//
//   App shell   public/meds/        static files built from medtrack/client
//   API         /meds/api/*         handled here, inside one Durable Object
//   Storage     SQLite inside the Durable Object (no data lives in this repo)
//
// Access model (fails closed until a passcode is enrolled):
//   - Browser: passcode sign-in sets an HttpOnly session cookie scoped to /meds.
//   - Automation: the same passcode sent as the X-Meds-Key header.
//   - Setup: X-Meds-Admin carries a one-off setup key. Only its SHA-256 is
//     stored below, so this file can be public. To reset a forgotten passcode,
//     generate a new random key, replace the hash, deploy, and call
//     POST /meds/api/auth/enroll with the new key.
import { DurableObject } from "cloudflare:workers";
import { createApi, type ApiResponse, type SqlDb } from "../medtrack/server/core";

export interface MedsEnv {
    MEDTRACK: DurableObjectNamespace;
}

const API_PREFIX = "/meds/api";
const SETUP_KEY_SHA256 = "83f914967ae1197505cb916e43ab33c94c73b076e91e26c5ef8bc31ac3c98238";

const COOKIE = "meds_session";
const SESSION_MS = 365 * 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

// Guess limits. Five wrong tries from one address locks that address out,
// doubling each time. A site-wide cap stops guessing spread across addresses.
const IP_FREE_TRIES = 5;
const IP_LOCK_MS = 15 * 60 * 1000;
const IP_LOCK_MAX_MS = 24 * 60 * 60 * 1000;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_MAX_FAILS = 40;

export function isMedsApi(pathname: string): boolean {
    return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

export async function handleMeds(request: Request, env: MedsEnv): Promise<Response> {
    const length = Number(request.headers.get("Content-Length") || "0");
    if (length > MAX_BODY_BYTES) return json(413, { message: "That file is too large." });
    const stub = env.MEDTRACK.get(env.MEDTRACK.idFromName("primary"));
    return stub.fetch(request);
}

const BASE_HEADERS: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra },
    });
}

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function readCookie(request: Request, name: string): string {
    for (const part of (request.headers.get("Cookie") || "").split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k === name) return v.join("=");
    }
    return "";
}

const sessionCookie = (token: string, maxAgeSec: number) =>
    `${COOKIE}=${token}; Path=/meds; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`;

class Rollback {
    constructor(public out: ApiResponse) {}
}

type PassResult = "ok" | "bad" | "locked" | "unset";

export class MedTrackDO extends DurableObject {
    private sql: SqlStorage;
    private api: ReturnType<typeof createApi>;

    constructor(ctx: DurableObjectState, env: unknown) {
        super(ctx, env as never);
        const sql = ctx.storage.sql;
        this.sql = sql;
        const bind = (params: unknown[] = []) => params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p)) as never[];
        const db: SqlDb = {
            all: (q, params) => sql.exec(q, ...bind(params)).toArray(),
            run: (q, params) => {
                const cur = sql.exec(q, ...bind(params));
                cur.toArray();
                const lastId = Number(sql.exec("SELECT last_insert_rowid() AS id").one().id);
                return { lastId, changes: cur.rowsWritten };
            },
        };
        this.api = createApi(db);
        sql.exec(`CREATE TABLE IF NOT EXISTS auth_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
        sql.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL, refreshed INTEGER NOT NULL)`);
        sql.exec(`CREATE TABLE IF NOT EXISTS auth_fails (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, last INTEGER NOT NULL, lock_until INTEGER NOT NULL DEFAULT 0)`);
    }

    // ── Small key/value helpers ─────────────────────────────────────────────
    private kv(key: string): string {
        const row = this.sql.exec(`SELECT value FROM auth_kv WHERE key = ?`, key).toArray()[0];
        return row ? String(row.value) : "";
    }
    private setKv(key: string, value: string) {
        this.sql.exec(`INSERT INTO auth_kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);
    }

    // ── Guess limiting ──────────────────────────────────────────────────────
    private lockedFor(ip: string, now: number): number {
        const row = this.sql.exec(`SELECT lock_until FROM auth_fails WHERE ip = ?`, ip).toArray()[0];
        const ipLock = row ? Number(row.lock_until) - now : 0;
        const start = Number(this.kv("fail_window_start") || "0");
        const count = Number(this.kv("fail_window_count") || "0");
        const globalLock = now - start < GLOBAL_WINDOW_MS && count >= GLOBAL_MAX_FAILS ? start + GLOBAL_WINDOW_MS - now : 0;
        return Math.max(ipLock, globalLock, 0);
    }
    private recordFail(ip: string, now: number) {
        const row = this.sql.exec(`SELECT count FROM auth_fails WHERE ip = ?`, ip).toArray()[0];
        const count = (row ? Number(row.count) : 0) + 1;
        const over = count - IP_FREE_TRIES;
        const lockUntil = over >= 0 ? now + Math.min(IP_LOCK_MS * 2 ** Math.min(over, 10), IP_LOCK_MAX_MS) : 0;
        this.sql.exec(
            `INSERT INTO auth_fails(ip, count, last, lock_until) VALUES(?, ?, ?, ?)
             ON CONFLICT(ip) DO UPDATE SET count = excluded.count, last = excluded.last, lock_until = excluded.lock_until`,
            ip, count, now, lockUntil,
        );
        const start = Number(this.kv("fail_window_start") || "0");
        if (now - start >= GLOBAL_WINDOW_MS) {
            this.setKv("fail_window_start", String(now));
            this.setKv("fail_window_count", "1");
            this.sql.exec(`DELETE FROM auth_fails WHERE last < ? AND lock_until < ?`, now - 7 * 24 * 60 * 60 * 1000, now);
        } else {
            this.setKv("fail_window_count", String(Number(this.kv("fail_window_count") || "0") + 1));
        }
    }
    private clearFails(ip: string) {
        this.sql.exec(`DELETE FROM auth_fails WHERE ip = ?`, ip);
    }

    // ── Credentials ─────────────────────────────────────────────────────────
    private async checkPasscode(candidate: string, ip: string, now: number): Promise<PassResult> {
        const hash = this.kv("pass_hash");
        if (!hash) return "unset";
        if (this.lockedFor(ip, now) > 0) return "locked";
        const got = await sha256Hex(`medtrack:v1:${this.kv("pass_salt")}:${candidate.trim()}`);
        if (safeEqual(got, hash)) {
            this.clearFails(ip);
            return "ok";
        }
        this.recordFail(ip, now);
        return "bad";
    }
    private async checkSetupKey(candidate: string, ip: string, now: number): Promise<PassResult> {
        if (this.lockedFor(ip, now) > 0) return "locked";
        if (safeEqual(await sha256Hex(candidate.trim()), SETUP_KEY_SHA256)) return "ok";
        this.recordFail(ip, now);
        return "bad";
    }
    /** Returns the session row for a valid cookie, refreshing its expiry when due. */
    private async session(request: Request, now: number): Promise<{ hash: string; token: string; refresh: boolean } | null> {
        const token = readCookie(request, COOKIE);
        if (!/^[0-9a-f]{64}$/.test(token)) return null;
        const hash = await sha256Hex(token);
        const row = this.sql.exec(`SELECT expires, refreshed FROM auth_sessions WHERE token_hash = ?`, hash).toArray()[0];
        if (!row || Number(row.expires) < now) return null;
        const refresh = now - Number(row.refreshed) > REFRESH_AFTER_MS;
        if (refresh) this.sql.exec(`UPDATE auth_sessions SET expires = ?, refreshed = ? WHERE token_hash = ?`, now + SESSION_MS, now, hash);
        return { hash, token, refresh };
    }

    private lockedResponse(ip: string, now: number): Response {
        const minutes = Math.max(1, Math.ceil(this.lockedFor(ip, now) / 60000));
        return json(429, { message: `Too many wrong tries. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` });
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, "") || "/";
        const method = request.method.toUpperCase();
        const now = Date.now();
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return json(405, { message: "Method not allowed" });

        let body: any = {};
        if (method !== "GET") {
            const raw = await request.text();
            if (raw.length > MAX_BODY_BYTES) return json(413, { message: "That file is too large." });
            if (raw) {
                try {
                    body = JSON.parse(raw);
                } catch {
                    return json(400, { message: "Request body must be JSON." });
                }
            }
        }

        // Browsers attach Origin to every state-changing request. A mismatch means
        // another site is trying to act with this browser's session.
        const origin = request.headers.get("Origin");
        const sameOrigin = origin === url.origin;
        const adminHeader = request.headers.get("X-Meds-Admin") || "";
        const keyHeader = request.headers.get("X-Meds-Key") || "";

        // ── Auth endpoints ──────────────────────────────────────────────────
        if (path === "/auth/status" && method === "GET") {
            return json(200, { configured: !!this.kv("pass_hash"), signedIn: !!(await this.session(request, now)) });
        }
        if (path === "/auth/login" && method === "POST") {
            if (origin && !sameOrigin) return json(403, { message: "Cross-site request refused." });
            const result = await this.checkPasscode(String(body?.passcode ?? ""), ip, now);
            if (result === "unset") return json(503, { message: "No passcode has been set up yet." });
            if (result === "locked") return this.lockedResponse(ip, now);
            if (result === "bad") return json(401, { message: "That passcode did not match." });
            const token = randomHex(32);
            this.sql.exec(`INSERT INTO auth_sessions(token_hash, created, expires, refreshed) VALUES(?, ?, ?, ?)`, await sha256Hex(token), now, now + SESSION_MS, now);
            this.sql.exec(`DELETE FROM auth_sessions WHERE expires < ?`, now);
            return json(200, { ok: true }, { "Set-Cookie": sessionCookie(token, SESSION_MS / 1000) });
        }
        if (path === "/auth/logout" && method === "POST") {
            const s = await this.session(request, now);
            if (s) this.sql.exec(`DELETE FROM auth_sessions WHERE token_hash = ?`, s.hash);
            return json(200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
        }
        if (path === "/auth/enroll" && (method === "POST" || method === "DELETE")) {
            const admin = await this.checkSetupKey(adminHeader, ip, now);
            if (admin === "locked") return this.lockedResponse(ip, now);
            if (admin !== "ok") return json(401, { message: "Setup key required." });
            this.sql.exec(`DELETE FROM auth_sessions`);
            if (method === "DELETE") {
                this.sql.exec(`DELETE FROM auth_kv WHERE key IN ('pass_hash', 'pass_salt')`);
                return json(200, { ok: true, configured: false });
            }
            const passcode = String(keyHeader || body?.passcode || "").trim();
            if (passcode.length < 8 || passcode.length > 200) return json(400, { message: "The passcode must be 8 to 200 characters." });
            const salt = randomHex(16);
            this.setKv("pass_salt", salt);
            this.setKv("pass_hash", await sha256Hex(`medtrack:v1:${salt}:${passcode}`));
            return json(200, { ok: true, configured: true, length: passcode.length });
        }

        // ── Everything else needs a signed-in browser, the passcode header, or the setup key ──
        let setCookie = "";
        if (adminHeader) {
            const r = await this.checkSetupKey(adminHeader, ip, now);
            if (r === "locked") return this.lockedResponse(ip, now);
            if (r !== "ok") return json(401, { message: "Sign in required." });
        } else if (keyHeader) {
            const r = await this.checkPasscode(keyHeader, ip, now);
            if (r === "locked") return this.lockedResponse(ip, now);
            if (r !== "ok") return json(401, { message: "Sign in required." });
        } else {
            const s = await this.session(request, now);
            if (!s) return json(401, { message: "Sign in required." });
            if (method !== "GET" && !sameOrigin) return json(403, { message: "Cross-site request refused." });
            if (s.refresh) setCookie = sessionCookie(s.token, SESSION_MS / 1000);
        }

        if (path === "/auth/logout-all" && method === "POST") {
            this.sql.exec(`DELETE FROM auth_sessions`);
            return json(200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
        }

        const query: Record<string, string> = {};
        url.searchParams.forEach((v, k) => (query[k] = v));

        let out: ApiResponse;
        try {
            // One transaction per request, so a rejected request leaves nothing half-written.
            out = this.ctx.storage.transactionSync(() => {
                const o = this.api.handle(method, `/api${path}`, query, body);
                if (o.status >= 400) throw new Rollback(o);
                return o;
            });
        } catch (e) {
            if (e instanceof Rollback) out = e.out;
            else {
                console.error("MedTrack API error:", e);
                out = { status: 400, json: { message: e instanceof Error ? e.message : "Request failed" } };
            }
        }

        const extra: Record<string, string> = setCookie ? { "Set-Cookie": setCookie } : {};
        if (out.text == null) return json(out.status, out.json ?? {}, extra);
        const headers: Record<string, string> = { ...BASE_HEADERS, ...extra, "Content-Type": out.contentType ?? "text/plain; charset=utf-8" };
        if (out.filename) headers["Content-Disposition"] = `attachment; filename="${out.filename}"`;
        if ((out.contentType ?? "").includes("text/html")) headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
        return new Response(out.text, { status: out.status, headers });
    }
}
