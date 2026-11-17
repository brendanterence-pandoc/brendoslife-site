// Home Projects: room-by-room decorating tracker for 6506 Waters Edge Way.
//
// Pages live under /watersedge/home/ (static, in public/). This module serves
// the JSON API at /api/home/*. Both sit behind the existing Waters Edge
// password gate in src/index.ts, so nothing here does its own sign-in.
//
//   GET    /api/home/state            every record, grouped by kind
//   POST   /api/home/batch            { ops: [{ op: "put" | "delete", kind, id, data }] }
//   POST   /api/home/photos?...       raw image bytes in the body; creates a photo record
//   GET    /api/home/photo/<id>       the stored image
//   DELETE /api/home/photos/<id>      removes the record and the stored image
//
// Records are kept in one SQLite-backed Durable Object (single writer, so two
// phones editing at once cannot corrupt each other). Image bytes go to the
// existing R2 bucket under the home/ prefix.

import { DurableObject } from "cloudflare:workers";
import { HOME_SEED } from "./home-seed";

export interface HomeEnv {
    HOMEPROJECTS: DurableObjectNamespace;
    PHOTOS_BUCKET: R2Bucket;
}

const API_PREFIX = "/api/home";
const MAX_JSON_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_OPS = 60;

const IMAGE_TYPES: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
};

export const KINDS = ["room", "measurement", "project", "decision", "item", "photo"] as const;
export type Kind = (typeof KINDS)[number];

export const STATUSES = ["Considering", "Ordered", "Arrived", "Installed", "Passed"] as const;
export const CATEGORIES = ["Artwork", "Framing", "Furniture", "Lighting", "Accessories"] as const;

export function isHomeApi(pathname: string): boolean {
    return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

const BASE_HEADERS: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
};

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
}

function newId(): string {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// ---------------------------------------------------------------------------
// Validation. Every record is rebuilt field by field, so unknown keys and
// oversized values never reach storage.
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function str(v: unknown, max: number): string {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function idOrEmpty(v: unknown): string {
    return typeof v === "string" && ID_RE.test(v) ? v : "";
}
function num(v: unknown, min: number, max: number): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return Math.round(n * 1000) / 1000;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
    return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function link(v: unknown): string {
    const s = str(v, 600);
    if (!s) return "";
    try {
        const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
        return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
    } catch {
        return "";
    }
}

function clean(kind: Kind, id: string, d: Rec, prev: Rec | null): Rec | string {
    const sort = num(d.sort, -1e9, 1e9) ?? (prev?.sort as number | undefined) ?? Date.now();
    const created = (prev?.created as number | undefined) ?? Date.now();
    switch (kind) {
        case "room": {
            const name = str(d.name, 60);
            if (!name) return "A room needs a name.";
            return { id, name, note: str(d.note, 1000), coverPhotoId: idOrEmpty(d.coverPhotoId), sort, created };
        }
        case "measurement": {
            const label = str(d.label, 120);
            if (!label) return "A measurement needs a label.";
            return {
                id, roomId: idOrEmpty(d.roomId), label,
                kind: oneOf(d.kind, ["wall", "furniture", "opening", "other"] as const, "wall"),
                w: num(d.w, 0, 5000), h: num(d.h, 0, 5000), d: num(d.d, 0, 5000),
                note: str(d.note, 500), sort, created,
            };
        }
        case "project": {
            const name = str(d.name, 120);
            if (!name) return "A project needs a name.";
            const steps = Array.isArray(d.steps) ? d.steps.slice(0, 40) : [];
            return {
                id, roomId: idOrEmpty(d.roomId), name,
                status: oneOf(d.status, ["Planning", "In progress", "Done"] as const, "Planning"),
                note: str(d.note, 4000),
                steps: steps
                    .map((s) => {
                        const o = (s ?? {}) as Rec;
                        return { id: idOrEmpty(o.id) || newId(), text: str(o.text, 300), done: o.done === true };
                    })
                    .filter((s) => s.text),
                sort, created,
            };
        }
        case "decision": {
            const name = str(d.name, 120);
            if (!name) return "A comparison needs a name.";
            return {
                id, roomId: idOrEmpty(d.roomId), projectId: idOrEmpty(d.projectId), name,
                note: str(d.note, 2000), pickedItemId: idOrEmpty(d.pickedItemId), sort, created,
            };
        }
        case "item": {
            const name = str(d.name, 160);
            if (!name) return "An item needs a name.";
            return {
                id, roomId: idOrEmpty(d.roomId), projectId: idOrEmpty(d.projectId),
                decisionId: idOrEmpty(d.decisionId), name,
                category: oneOf(d.category, CATEGORIES, "Furniture"),
                status: oneOf(d.status, STATUSES, "Considering"),
                price: num(d.price, 0, 10_000_000), qty: num(d.qty, 1, 999) ?? 1,
                w: num(d.w, 0, 5000), h: num(d.h, 0, 5000), d: num(d.d, 0, 5000),
                link: link(d.link), vendor: str(d.vendor, 160), note: str(d.note, 4000),
                photoId: idOrEmpty(d.photoId), sort, created,
            };
        }
        case "photo": {
            // Storage location (key/src) is set by the server only and can never be edited.
            if (!prev) return "Photos are added by upload.";
            return {
                ...prev,
                roomId: idOrEmpty(d.roomId) || (prev.roomId as string),
                itemId: idOrEmpty(d.itemId),
                projectId: idOrEmpty(d.projectId),
                kind: oneOf(d.kind, ["room", "mockup", "item"] as const, (prev.kind as "room") || "room"),
                caption: str(d.caption, 300),
                sort,
            };
        }
    }
}

// ---------------------------------------------------------------------------
// Worker-side entry point
// ---------------------------------------------------------------------------

export async function handleHome(request: Request, env: HomeEnv, pathname: string): Promise<Response> {
    const stub = env.HOMEPROJECTS.get(env.HOMEPROJECTS.idFromName("primary"));
    const method = request.method;
    const rest = pathname.slice(API_PREFIX.length);
    const length = Number(request.headers.get("Content-Length") || "0");

    try {
        if (rest === "/state" && method === "GET") {
            return stub.fetch("https://do/state");
        }

        if (rest === "/batch" && method === "POST") {
            if (length > MAX_JSON_BYTES) return json(413, { error: "That change is too large." });
            return stub.fetch("https://do/batch", { method: "POST", body: await request.text() });
        }

        if (rest === "/photos" && method === "POST") {
            const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
            const ext = IMAGE_TYPES[type];
            if (!ext) return json(415, { error: "Photos must be JPEG, PNG, WebP, or GIF." });
            if (length > MAX_IMAGE_BYTES) return json(413, { error: "That photo is too large. The limit is 12 MB." });
            const bytes = await request.arrayBuffer();
            if (bytes.byteLength === 0) return json(400, { error: "The photo was empty." });
            if (bytes.byteLength > MAX_IMAGE_BYTES) return json(413, { error: "That photo is too large. The limit is 12 MB." });

            const q = new URL(request.url).searchParams;
            const id = newId();
            const key = `home/photos/${id}.${ext}`;
            await env.PHOTOS_BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });

            const res = await stub.fetch("https://do/photo", {
                method: "POST",
                body: JSON.stringify({
                    id, key, type, size: bytes.byteLength,
                    roomId: q.get("roomId"), itemId: q.get("itemId"), projectId: q.get("projectId"),
                    kind: q.get("kind"), caption: q.get("caption"), w: q.get("w"), h: q.get("h"),
                    setCover: q.get("setCover") === "1", setItemPhoto: q.get("setItemPhoto") === "1",
                }),
            });
            if (!res.ok) await env.PHOTOS_BUCKET.delete(key);
            return res;
        }

        if (rest.startsWith("/photo/") && method === "GET") {
            const id = rest.slice("/photo/".length);
            if (!ID_RE.test(id)) return json(404, { error: "Not found" });
            const look = await stub.fetch(`https://do/photo-key?id=${id}`);
            if (!look.ok) return json(404, { error: "Not found" });
            const { key } = (await look.json()) as { key: string };
            const obj = await env.PHOTOS_BUCKET.get(key);
            if (!obj) return json(404, { error: "Not found" });
            return new Response(obj.body, {
                headers: {
                    "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
                    // Image bytes never change for a given id, so the browser may keep them.
                    "Cache-Control": "private, max-age=31536000, immutable",
                    "X-Robots-Tag": "noindex, nofollow, noarchive",
                    "X-Content-Type-Options": "nosniff",
                },
            });
        }

        if (rest.startsWith("/photos/") && method === "DELETE") {
            const id = rest.slice("/photos/".length);
            if (!ID_RE.test(id)) return json(404, { error: "Not found" });
            const res = await stub.fetch(`https://do/photo?id=${id}`, { method: "DELETE" });
            if (!res.ok) return res;
            const out = (await res.json()) as { key?: string; state: unknown };
            if (out.key) await env.PHOTOS_BUCKET.delete(out.key);
            return json(200, { ok: true, state: out.state });
        }

        return json(404, { error: "Not found" });
    } catch (err) {
        console.error("home api error", err);
        return json(500, { error: "Something went wrong saving that. Please try again." });
    }
}

// ---------------------------------------------------------------------------
// Durable Object: the record store
// ---------------------------------------------------------------------------

interface Op {
    op: "put" | "delete";
    kind: Kind;
    id: string;
    data?: Rec;
}

export class HomeProjectsDO extends DurableObject {
    private sql: SqlStorage;

    constructor(ctx: DurableObjectState, env: unknown) {
        super(ctx, env as never);
        this.sql = ctx.storage.sql;
        this.sql.exec(
            `CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (kind, id))`
        );
        this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
        this.seedOnce();
    }

    // Starter rooms, projects, and items are written exactly once. After that
    // the data belongs to the user: deleting a starter record keeps it deleted.
    private seedOnce(): void {
        const done = this.sql.exec(`SELECT value FROM meta WHERE key = 'seeded'`).toArray()[0];
        if (done) return;
        const now = Date.now();
        for (const kind of KINDS) {
            const rows = (HOME_SEED as Record<string, Rec[]>)[kind] || [];
            rows.forEach((row, i) => {
                const rec = { sort: (i + 1) * 1000, created: now, ...row };
                this.sql.exec(
                    `INSERT OR IGNORE INTO records (kind, id, data, updated) VALUES (?, ?, ?, ?)`,
                    kind, String(row.id), JSON.stringify(rec), now
                );
            });
        }
        this.sql.exec(`INSERT INTO meta (key, value) VALUES ('seeded', ?)`, String(now));
    }

    private get(kind: Kind, id: string): Rec | null {
        const row = this.sql.exec(`SELECT data FROM records WHERE kind = ? AND id = ?`, kind, id).toArray()[0];
        return row ? (JSON.parse(String(row.data)) as Rec) : null;
    }

    private put(kind: Kind, rec: Rec): void {
        this.sql.exec(
            `INSERT INTO records (kind, id, data, updated) VALUES (?, ?, ?, ?)
             ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, updated = excluded.updated`,
            kind, String(rec.id), JSON.stringify(rec), Date.now()
        );
    }

    private del(kind: Kind, id: string): void {
        this.sql.exec(`DELETE FROM records WHERE kind = ? AND id = ?`, kind, id);
    }

    private state(): Record<string, Rec[]> {
        const out: Record<string, Rec[]> = {};
        for (const kind of KINDS) out[kind] = [];
        for (const row of this.sql.exec(`SELECT kind, data FROM records`).toArray()) {
            const rec = JSON.parse(String(row.data)) as Rec;
            // Never send storage keys to the browser.
            if (row.kind === "photo") delete rec.key;
            out[String(row.kind)]?.push(rec);
        }
        for (const kind of KINDS) out[kind].sort((a, b) => Number(a.sort) - Number(b.sort));
        return out;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        if (path === "/state") return json(200, { state: this.state() });

        if (path === "/batch") {
            let body: { ops?: Op[] };
            try {
                body = JSON.parse(await request.text());
            } catch {
                return json(400, { error: "That change could not be read." });
            }
            const ops = Array.isArray(body.ops) ? body.ops : [];
            if (!ops.length || ops.length > MAX_OPS) return json(400, { error: "Nothing to save." });

            // Check everything first, then write, so a bad op never leaves a half-saved batch.
            const writes: Array<() => void> = [];
            for (const op of ops) {
                if (!(KINDS as readonly string[]).includes(op?.kind) || !ID_RE.test(String(op?.id))) {
                    return json(400, { error: "That change could not be read." });
                }
                if (op.op === "delete") {
                    if (op.kind === "photo") return json(400, { error: "Use the photo delete button." });
                    writes.push(() => this.del(op.kind, op.id));
                    continue;
                }
                if (op.op !== "put" || typeof op.data !== "object" || op.data === null) {
                    return json(400, { error: "That change could not be read." });
                }
                const prev = this.get(op.kind, op.id);
                const rec = clean(op.kind, op.id, op.data, prev);
                if (typeof rec === "string") return json(400, { error: rec });
                writes.push(() => this.put(op.kind, rec));
            }
            this.ctx.storage.transactionSync(() => writes.forEach((w) => w()));
            return json(200, { ok: true, state: this.state() });
        }

        if (path === "/photo" && request.method === "POST") {
            const b = (await request.json()) as Rec;
            const id = String(b.id);
            const rec: Rec = {
                id, key: String(b.key), type: str(b.type, 40), size: num(b.size, 0, 1e9),
                roomId: idOrEmpty(b.roomId), itemId: idOrEmpty(b.itemId), projectId: idOrEmpty(b.projectId),
                kind: oneOf(b.kind, ["room", "mockup", "item"] as const, "room"),
                caption: str(b.caption, 300), w: num(b.w, 1, 20000), h: num(b.h, 1, 20000),
                sort: Date.now(), created: Date.now(),
            };
            this.ctx.storage.transactionSync(() => {
                this.put("photo", rec);
                if (b.setCover === true && rec.roomId) {
                    const room = this.get("room", String(rec.roomId));
                    if (room) this.put("room", { ...room, coverPhotoId: id });
                }
                if (b.setItemPhoto === true && rec.itemId) {
                    const item = this.get("item", String(rec.itemId));
                    if (item) this.put("item", { ...item, photoId: id });
                }
            });
            return json(200, { ok: true, id, state: this.state() });
        }

        if (path === "/photo-key") {
            const rec = this.get("photo", url.searchParams.get("id") || "");
            if (!rec || typeof rec.key !== "string") return json(404, { error: "Not found" });
            return json(200, { key: rec.key });
        }

        if (path === "/photo" && request.method === "DELETE") {
            const id = url.searchParams.get("id") || "";
            const rec = this.get("photo", id);
            if (!rec) return json(404, { error: "Not found" });
            this.ctx.storage.transactionSync(() => {
                this.del("photo", id);
                // Clear any pointers to the removed photo.
                for (const row of this.sql.exec(`SELECT kind, data FROM records WHERE kind IN ('room', 'item')`).toArray()) {
                    const r = JSON.parse(String(row.data)) as Rec;
                    if (row.kind === "room" && r.coverPhotoId === id) this.put("room", { ...r, coverPhotoId: "" });
                    if (row.kind === "item" && r.photoId === id) this.put("item", { ...r, photoId: "" });
                }
            });
            return json(200, { key: typeof rec.key === "string" ? rec.key : "", state: this.state() });
        }

        return json(404, { error: "Not found" });
    }
}
