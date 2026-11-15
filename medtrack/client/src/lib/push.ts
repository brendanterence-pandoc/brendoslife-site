import { AUTH_ENABLED, apiRequest } from "./queryClient";

/** Reminders exist only on the hosted build, where the server can send them. */
export const REMINDERS_AVAILABLE = AUTH_ENABLED;

export interface PushConfig {
  publicKey: string;
  followupMin: number;
  showNames: boolean;
  tz: string;
  devices: number;
}

export type PushSupport = "ok" | "needs-home-screen" | "unsupported";
export function pushSupport(): PushSupport {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "ok";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone ? "needs-home-screen" : "unsupported";
}

let registration: Promise<ServiceWorkerRegistration> | null = null;
export function registerWorker(): Promise<ServiceWorkerRegistration> | null {
  if (!REMINDERS_AVAILABLE || !("serviceWorker" in navigator)) return null;
  registration ??= navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(() => navigator.serviceWorker.ready);
  registration.catch(() => (registration = null));
  return registration;
}

const keyBytes = (b64: string) => {
  const t = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const deviceLabel = () => (/iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Android/.test(navigator.userAgent) ? "Android" : "Computer");

const save = async (sub: PushSubscription): Promise<PushConfig> =>
  (await apiRequest("POST", "/api/push/subscribe", { subscription: sub.toJSON(), tz: zone(), label: deviceLabel() })).json();

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registerWorker();
  return reg ? reg.pushManager.getSubscription() : null;
}
let synced: Promise<PushSubscription | null> | null = null;
/** Once per page load, re-sends this device's registration so the server copy and time zone stay current. */
export function refreshSubscription(): Promise<PushSubscription | null> {
  synced ??= (async () => {
    const sub = await currentSubscription();
    if (sub) await save(sub);
    return sub;
  })();
  synced.catch(() => (synced = null));
  return synced;
}
/** Must be called straight from a tap. Browsers only show the permission prompt in response to one. */
export async function turnOn(publicKey: string): Promise<{ sub: PushSubscription; config: PushConfig }> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are not allowed for MedTrack on this device.");
  const reg = await registerWorker();
  if (!reg) throw new Error("This browser cannot receive reminders.");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  synced = null;
  return { sub, config: await save(sub) };
}
export async function turnOff(): Promise<PushConfig | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  synced = null;
  const res = await apiRequest("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => undefined);
  return res.json();
}
