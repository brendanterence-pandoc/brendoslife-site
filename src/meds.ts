// MedTrack: private medication and symptom tracker at /meds.
//
//   App shell   public/meds/        static files built from medtrack/client
//   API         /meds/api/*         handled here, inside one Durable Object
//   Storage     SQLite inside the Durable Object (no data lives in this repo)
//
// Access model (fails closed until a passcode is enrolled):
//   - Browser: passcode sign-in sets an HttpOnly session cookie scoped to /meds.
//   - Automation: the same passcode sent as the X-Meds-Key header.
//
// Reminders: devices that turn reminders on register a Web Push subscription.
// A Durable Object alarm wakes at each scheduled time and notifies them. The
// push signing key is generated here on first use and stored only in the object.
//
//   - Setup: X-Meds-Admin carries a one-off setup key. Only its SHA-256 is
//     stored below, so this file can be public. To reset a forgotten passcode,
//     generate a new random key, replace the hash, deploy, and call
//     POST /meds/api/auth/enroll with the new key.
import { DurableObject } from "cloudflare:workers";
import { createApi, type ApiResponse, type SqlDb } from "../medtrack/server/core";
import type { AppState, Item, Log } from "../medtrack/shared/schema";
import { addDays } from "../medtrack/shared/schedule";
import { PUSH_HOST, createVapid, localStamp, planReminders, reminderMessage, sendPush, validZone, type PushSub, type ReminderSettings, type Vapid } from "./meds-push";

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
        sql.exec(`CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, last_status INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0)`);
        sql.exec(`CREATE TABLE IF NOT EXISTS push_sent (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
    }

    // ── Reminders ───────────────────────────────────────────────────────────
    private reminderSettings(): ReminderSettings {
        const followup = this.kv("rem_followup");
        return { followupMin: followup === "" ? 30 : Number(followup), showNames: this.kv("rem_names") === "1", tz: this.kv("rem_tz") || "UTC" };
    }
    private subs(): PushSub[] {
        return this.sql.exec(`SELECT endpoint, p256dh, auth FROM push_subs ORDER BY created`).toArray()
            .map((r) => ({ endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth) }));
    }
    private async vapid(): Promise<Vapid> {
        const saved = this.kv("vapid");
        if (saved) return JSON.parse(saved) as Vapid;
        const fresh = await createVapid();
        this.setKv("vapid", JSON.stringify(fresh));
        return fresh;
    }
    private regimen(nowMs: number, tz: string): { items: Item[]; logs: Log[] } {
        const today = localStamp(nowMs, tz).slice(0, 10);
        const items = (this.api.handle("GET", "/api/state", {}, {}).json as AppState).items;
        const logs = this.api.handle("GET", "/api/logs", { from: addDays(today, -1), to: addDays(today, 1) }, {}).json as Log[];
        return { items, logs };
    }
    /** Sends one notification to every registered device and drops devices that no longer exist. */
    private async deliver(payload: unknown, ttlSeconds: number): Promise<number[]> {
        const vapid = await this.vapid();
        const subject = this.kv("rem_subject") || "https://example.com/";
        const statuses: number[] = [];
        for (const sub of this.subs()) {
            let status = 0;
            try {
                status = await sendPush(sub, payload, vapid, subject, ttlSeconds);
            } catch (e) {
                console.error("MedTrack reminder failed:", e);
            }
            if (status === 404 || status === 410) this.sql.exec(`DELETE FROM push_subs WHERE endpoint = ?`, sub.endpoint);
            else this.sql.exec(`UPDATE push_subs SET last_status = ?, last_at = ? WHERE endpoint = ?`, status, Date.now(), sub.endpoint);
            statuses.push(status);
        }
        return statuses;
    }
    /** Points the alarm at the next scheduled time, or clears it when no device wants reminders. */
    private async planAlarm(): Promise<void> {
        const now = Date.now();
        if (!this.subs().length) {
            await this.ctx.storage.deleteAlarm();
            return;
        }
        const s = this.reminderSettings();
        const { items, logs } = this.regimen(now, s.tz);
        const { nextMs } = planReminders(items, logs, now, s, new Set());
        await this.ctx.storage.setAlarm(nextMs ?? now + 24 * 60 * 60 * 1000);
    }
    async alarm(): Promise<void> {
        const now = Date.now();
        if (this.subs().length) {
            const s = this.reminderSettings();
            const { items, logs } = this.regimen(now, s.tz);
            const sent = new Set(this.sql.exec(`SELECT key FROM push_sent`).toArray().map((r) => String(r.key)));
            for (const r of planReminders(items, logs, now, s, sent).due) {
                // Marked first, so a retry after a failure never sends the same reminder twice.
                this.sql.exec(`INSERT OR IGNORE INTO push_sent(key, at) VALUES(?, ?)`, r.key, now);
                if (r.open.length) await this.deliver(reminderMessage(r, s), 3600);
            }
            this.sql.exec(`DELETE FROM push_sent WHERE at < ?`, now - 3 * 24 * 60 * 60 * 1000);
        }
        await this.planAlarm();
    }
    private async pushRoute(path: string, method: string, body: any, origin: string): Promise<Response> {
        const config = async () => {
            const s = this.reminderSettings();
            const last = this.sql.exec(`SELECT last_status, last_at FROM push_subs ORDER BY last_at DESC LIMIT 1`).toArray()[0];
            return {
                publicKey: (await this.vapid()).publicKey, followupMin: s.followupMin, showNames: s.showNames, tz: s.tz, devices: this.subs().length,
                // Most recent delivery attempt, for troubleshooting. 201 means the push service accepted it.
                lastStatus: last ? Number(last.last_status) : 0,
                lastAt: last && Number(last.last_at) ? new Date(Number(last.last_at)).toISOString() : null,
                nextAt: await this.ctx.storage.getAlarm().then((t) => (t ? new Date(t).toISOString() : null)),
            };
        };
        if (path === "/push/config" && method === "GET") return json(200, await config());
        if (path === "/push/subscribe" && method === "POST") {
            const endpoint = String(body?.subscription?.endpoint ?? "");
            const p256dh = String(body?.subscription?.keys?.p256dh ?? "").replace(/=+$/, "");
            const auth = String(body?.subscription?.keys?.auth ?? "").replace(/=+$/, "");
            if (!PUSH_HOST.test(endpoint) || endpoint.length > 1000 || !/^[A-Za-z0-9_-]{87}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22,64}$/.test(auth))
                return json(400, { message: "This device could not be registered for reminders." });
            const known = this.sql.exec(`SELECT 1 FROM push_subs WHERE endpoint = ?`, endpoint).toArray().length > 0;
            if (!known && this.subs().length >= 10) return json(400, { message: "Ten devices already get reminders. Turn one off first." });
            this.sql.exec(
                `INSERT INTO push_subs(endpoint, p256dh, auth, label, created) VALUES(?, ?, ?, ?, ?)
                 ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
                endpoint, p256dh, auth, String(body?.label ?? "").slice(0, 60), Date.now(),
            );
            if (typeof body?.tz === "string" && validZone(body.tz)) this.setKv("rem_tz", body.tz);
            this.setKv("rem_subject", `${origin}/meds/`);
            await this.planAlarm();
            return json(200, await config());
        }
        if (path === "/push/unsubscribe" && method === "POST") {
            this.sql.exec(`DELETE FROM push_subs WHERE endpoint = ?`, String(body?.endpoint ?? ""));
            await this.planAlarm();
            return json(200, await config());
        }
        if (path === "/push/settings" && method === "PUT") {
            if (body?.followupMin !== undefined) {
                const n = Number(body.followupMin);
                if (!Number.isInteger(n) || n < 0 || n > 240) return json(400, { message: "The second reminder can be 0 to 240 minutes later." });
                this.setKv("rem_followup", String(n));
            }
            if (body?.showNames !== undefined) this.setKv("rem_names", body.showNames ? "1" : "0");
            if (body?.tz !== undefined) {
                if (typeof body.tz !== "string" || !validZone(body.tz)) return json(400, { message: "Unknown time zone." });
                this.setKv("rem_tz", body.tz);
            }
            await this.planAlarm();
            return json(200, await config());
        }
        if (path === "/push/test" && method === "POST") {
            if (!this.subs().length) return json(400, { message: "Turn on reminders on a device first." });
            const statuses = await this.deliver({ title: "Reminders are on", body: "This is a test from MedTrack.", tag: "test", url: "./" }, 300);
            return json(200, { ok: statuses.some((x) => x >= 200 && x < 300), statuses, devices: this.subs().length });
        }
        return json(404, { message: "Not found" });
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
            if (!passcode) return json(400, { message: "No passcode was sent." });
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

        if (path.startsWith("/push/")) return this.pushRoute(path, method, body, url.origin);

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

        // A regimen change can move the next reminder.
        if (method !== "GET" && out.status < 400) await this.planAlarm().catch((e) => console.error("MedTrack alarm planning failed:", e));

        const extra: Record<string, string> = setCookie ? { "Set-Cookie": setCookie } : {};
        if (out.text == null) return json(out.status, out.json ?? {}, extra);
        const headers: Record<string, string> = { ...BASE_HEADERS, ...extra, "Content-Type": out.contentType ?? "text/plain; charset=utf-8" };
        if (out.filename) headers["Content-Disposition"] = `attachment; filename="${out.filename}"`;
        if ((out.contentType ?? "").includes("text/html")) headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
        return new Response(out.text, { status: out.status, headers });
    }
}
