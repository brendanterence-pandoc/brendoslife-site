// Pure date + schedule helpers shared by client, server and reports.
// All dates are local wall-clock strings: "YYYY-MM-DD", "HH:MM", "YYYY-MM-DDTHH:MM".
import type { Item, Log, Schedule } from "./schema";

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function toStamp(d: Date): string {
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}
export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86400000);
}
export function weekday(s: string): number {
  return parseDate(s).getDay();
}
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
export function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ap}`;
}
export function fmtStampTime(stamp: string): string {
  return fmtTime(stamp.slice(11, 16));
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function fmtDay(s: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = parseDate(s);
  let out = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (opts.weekday) out = `${DAYS[d.getDay()]}, ${out}`;
  if (opts.year) out += `, ${d.getFullYear()}`;
  return out;
}
export const DAY_NAMES = DAYS;

export function describeSchedule(s: Schedule): string {
  if (s.type === "daily") return "every day";
  if (s.type === "weekdays") {
    if (s.days.length === 7) return "every day";
    return [...s.days].sort().map((d) => DAYS[d]).join(", ");
  }
  return `every ${s.every} days`;
}
export function describeItem(i: Pick<Item, "prn" | "times" | "schedule" | "strength" | "dose">): string {
  const parts: string[] = [];
  if (i.strength) parts.push(i.strength);
  if (i.prn) parts.push("as needed");
  else if (i.times.length) {
    parts.push(`${i.times.map(fmtTime).join(", ")} ${describeSchedule(i.schedule)}`);
  } else parts.push("no schedule");
  return parts.join(", ");
}

export function isActiveOn(item: Item, date: string): boolean {
  return item.startDate <= date && (!item.endDate || date <= item.endDate);
}
export function isDueOn(item: Item, date: string): boolean {
  if (item.prn || !item.times.length || !isActiveOn(item, date)) return false;
  const s = item.schedule;
  if (s.type === "daily") return true;
  if (s.type === "weekdays") return s.days.includes(weekday(date));
  const n = diffDays(date, s.anchor);
  return n >= 0 && n % s.every === 0;
}

export type EntryState = "taken" | "skipped" | "recorded" | "missed" | "due" | "upcoming";
export interface Entry {
  item: Item;
  date: string;
  slot: string;
  log: Log | null;
  state: EntryState;
}

/** Hours after a scheduled time before an unlogged dose counts as missed. */
export const MISSED_AFTER_MIN = 240;

/**
 * Everything expected on a day: scheduled slots from the regimen active that day,
 * plus any logged scheduled entries (covers imported history and edited schedules).
 */
export function entriesForDay(items: Item[], logs: Log[], date: string, now: string): Entry[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const map = new Map<string, Entry>();
  const today = now.slice(0, 10);
  const nowMin = minutesOf(now.slice(11, 16));
  for (const item of items) {
    if (!isDueOn(item, date)) continue;
    for (const slot of item.times) {
      let state: EntryState;
      // Slots that came before the item was added on its first day are never counted as missed.
      const beforeAdded = !!item.startTime && date === item.startDate && slot < item.startTime;
      if (beforeAdded && date < today) continue;
      if (beforeAdded) state = date > today ? "upcoming" : "due";
      else if (date < today) state = "missed";
      else if (date > today) state = "upcoming";
      else {
        const m = minutesOf(slot);
        state = nowMin >= m + MISSED_AFTER_MIN ? "missed" : nowMin >= m ? "due" : "upcoming";
      }
      map.set(`${item.id}|${slot}`, { item, date, slot, log: null, state });
    }
  }
  for (const log of logs) {
    if (log.date !== date || !log.slot) continue;
    const item = byId.get(log.itemId);
    if (!item) continue;
    map.set(`${item.id}|${log.slot}`, { item, date, slot: log.slot, log, state: log.status });
  }
  return [...map.values()].sort(
    (a, b) =>
      a.slot.localeCompare(b.slot) ||
      (a.item.kind === b.item.kind ? 0 : a.item.kind === "med" ? -1 : 1) ||
      a.item.sort - b.item.sort ||
      a.item.name.localeCompare(b.item.name),
  );
}

export function unscheduledForDay(items: Item[], logs: Log[], date: string) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return logs
    .filter((l) => l.date === date && !l.slot && byId.has(l.itemId))
    .map((log) => ({ log, item: byId.get(log.itemId)! }))
    .sort((a, b) => a.log.at.localeCompare(b.log.at));
}

export const nameKey = (name: string) => name.trim().toLowerCase();
