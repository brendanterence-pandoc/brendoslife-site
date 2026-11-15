// MedTrack reminders: Web Push delivery (RFC 8030, 8291, 8292) and reminder
// timing. Standard Web Crypto only, so it runs in a Worker and under Node tests.
// No keys live in this file. The signing key pair is generated inside the
// Durable Object on first use and never leaves it.
import type { Item, Log } from "../medtrack/shared/schema";
import { addDays, fmtTime, isDueOn, minutesOf } from "../medtrack/shared/schedule";

const enc = new TextEncoder();

export function b64u(input: ArrayBuffer | Uint8Array): string {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
    const t = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

// ── Sender identity (VAPID) ──────────────────────────────────────────────────
export interface Vapid {
    publicKey: string;
    privateJwk: JsonWebKey;
}
export async function createVapid(): Promise<Vapid> {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
    const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    return { publicKey: b64u(raw), privateJwk };
}
export async function vapidHeader(endpoint: string, vapid: Vapid, subject: string, nowMs: number): Promise<string> {
    const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject })));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
    return `vapid t=${head}.${claims}.${b64u(sig as ArrayBuffer)}, k=${vapid.publicKey}`;
}

// ── Message encryption (aes128gcm, one record) ───────────────────────────────
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}
export async function encryptPayload(p256dh: string, auth: string, plaintext: Uint8Array): Promise<Uint8Array> {
    const uaPublic = unb64u(p256dh);
    const authSecret = unb64u(auth);
    if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("Bad subscription keys");
    const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as never, local.privateKey, 256));
    const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
    const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
    // 0x02 marks the final record.
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
    const header = new Uint8Array(21);
    header.set(salt, 0);
    new DataView(header.buffer).setUint32(16, 4096);
    header[20] = asPublic.length;
    return concat(header, asPublic, cipher);
}

export interface PushSub {
    endpoint: string;
    p256dh: string;
    auth: string;
}
/**
 * Push services change their host names, so there is no fixed list. A destination
 * must be a plain public https host: no addresses, ports, or sign-in parts.
 */
export const PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}\//i;

/** Returns the push service status: 201 accepted, 404 or 410 subscription gone. */
export async function sendPush(sub: PushSub, payload: unknown, vapid: Vapid, subject: string, ttlSeconds: number): Promise<number> {
    const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(payload)));
    const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
            Authorization: await vapidHeader(sub.endpoint, vapid, subject, Date.now()),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: String(ttlSeconds),
            Urgency: "high",
        },
        body,
    });
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
}

// ── Clock helpers ────────────────────────────────────────────────────────────
export function validZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}
/** Wall-clock "YYYY-MM-DDTHH:MM" in a time zone. */
export function localStamp(ms: number, tz: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
    return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}
const stampAsUtc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16));
/** The instant when a time zone's clock reads `minutes` after midnight on `date`. */
export function zonedToUtc(date: string, minutes: number, tz: string): number {
    const wall = stampAsUtc(`${date}T00:00`) + minutes * 60000;
    let guess = wall;
    for (let i = 0; i < 3; i++) guess += wall - stampAsUtc(localStamp(guess, tz));
    return guess;
}

// ── Reminder timing ──────────────────────────────────────────────────────────
export interface ReminderSettings {
    /** Minutes after the scheduled time to nudge again if items are still open. 0 turns the nudge off. */
    followupMin: number;
    /** Show medication and tracker names on the notification. Off shows counts only. */
    showNames: boolean;
    tz: string;
}
export interface DueReminder {
    key: string;
    date: string;
    slot: string;
    kind: "due" | "followup";
    /** Scheduled items in this slot with nothing logged yet. */
    open: Item[];
}
/** A reminder that could not go out on time is dropped after this long. */
export const GRACE_MS = 20 * 60 * 1000;

export function planReminders(items: Item[], logs: Log[], nowMs: number, s: ReminderSettings, sent: Set<string>): { due: DueReminder[]; nextMs: number | null } {
    const today = localStamp(nowMs, s.tz).slice(0, 10);
    const logged = new Set(logs.filter((l) => l.slot).map((l) => `${l.itemId}|${l.date}|${l.slot}`));
    const due: DueReminder[] = [];
    let nextMs: number | null = null;
    for (let offset = -1; offset <= 7; offset++) {
        const date = addDays(today, offset);
        const bySlot = new Map<string, Item[]>();
        for (const item of items) {
            if (!isDueOn(item, date)) continue;
            for (const slot of item.times) {
                // Slots from before the item was added on its first day are not expected.
                if (item.startTime && date === item.startDate && slot < item.startTime) continue;
                bySlot.set(slot, [...(bySlot.get(slot) ?? []), item]);
            }
        }
        for (const [slot, list] of bySlot) {
            const kinds: Array<["due" | "followup", number]> = s.followupMin > 0 ? [["due", 0], ["followup", s.followupMin]] : [["due", 0]];
            for (const [kind, plus] of kinds) {
                const atMs = zonedToUtc(date, minutesOf(slot) + plus, s.tz);
                const key = `${date}|${slot}|${kind}`;
                if (atMs > nowMs) {
                    if (nextMs == null || atMs < nextMs) nextMs = atMs;
                    continue;
                }
                if (nowMs - atMs > GRACE_MS || sent.has(key)) continue;
                due.push({ key, date, slot, kind, open: list.filter((i) => !logged.has(`${i.id}|${date}|${slot}`)) });
            }
        }
    }
    return { due, nextMs };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export function reminderMessage(r: DueReminder, s: ReminderSettings): { title: string; body: string; tag: string; url: string } {
    const meds = r.open.filter((i) => i.kind === "med");
    const trackers = r.open.filter((i) => i.kind !== "med");
    const time = fmtTime(r.slot);
    let body: string;
    if (s.showNames) {
        const parts: string[] = [];
        if (meds.length) parts.push(meds.map((i) => i.name).join(", "));
        if (trackers.length) parts.push(`Check-ins: ${trackers.map((i) => i.name).join(", ")}`);
        body = parts.join(". ") + ".";
    } else {
        const parts: string[] = [];
        if (meds.length) parts.push(plural(meds.length, "dose"));
        if (trackers.length) parts.push(plural(trackers.length, "check-in"));
        body = `${parts.join(" and ")} ${r.kind === "due" ? "to log" : "not logged yet"}.`;
    }
    return {
        title: r.kind === "due" ? `${time} is due` : `${time} is still open`,
        body,
        tag: `slot-${r.date}-${r.slot}`,
        url: "./",
    };
}
