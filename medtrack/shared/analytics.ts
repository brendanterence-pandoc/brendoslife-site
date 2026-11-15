// Report math shared by the Trends screen and the clinician report export.
import type { Change, HealthRow, Item, Log, Note } from "./schema";
import { addDays, dateRange, entriesForDay, minutesOf, nameKey } from "./schedule";

export interface TrackerDay {
  avg: number;
  max: number;
  min: number;
  n: number;
}
export interface DaySummary {
  date: string;
  expected: number;
  taken: number;
  skipped: number;
  missed: number;
  adherence: number | null;
  checkinsExpected: number;
  checkinsDone: number;
  trackers: Record<string, TrackerDay>;
  prn: Record<string, number>;
  prnTotal: number;
  categoryDoses: Record<string, number>;
  missedList: string[];
  skippedList: string[];
  health: Record<string, number>;
  notes: string[];
}
export interface MedSummary {
  name: string;
  strengths: string[];
  category: string;
  prn: boolean;
  expected: number;
  taken: number;
  skipped: number;
  missed: number;
  pct: number | null;
  avgDelayMin: number | null;
  onTimePct: number | null;
  prnCount: number;
  prnDays: number;
}
export interface TrackerSummary {
  name: string;
  color: string;
  scaleMax: number;
  n: number;
  daysLogged: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  firstThird: number | null;
  lastThird: number | null;
  trend: "improving" | "worsening" | "steady" | "n/a";
  bySlot: { slot: string; mean: number; n: number }[];
  highDays: { date: string; max: number }[];
}
export interface Correlation {
  a: string;
  b: string;
  r: number;
  n: number;
}
export interface Report {
  from: string;
  to: string;
  days: DaySummary[];
  meds: MedSummary[];
  trackers: TrackerSummary[];
  totals: {
    expected: number;
    taken: number;
    skipped: number;
    missed: number;
    adherence: number | null;
    checkinsExpected: number;
    checkinsDone: number;
    prnTotal: number;
    daysWithData: number;
  };
  correlations: Correlation[];
  healthMetrics: string[];
  changes: Change[];
  firstDataDate: string | null;
}

export const HEALTH_LABELS: Record<string, { label: string; unit: string; digits: number }> = {
  sleep_hours: { label: "Sleep", unit: "h", digits: 1 },
  steps: { label: "Steps", unit: "", digits: 0 },
  resting_hr: { label: "Resting HR", unit: "bpm", digits: 0 },
  hrv_sdnn: { label: "HRV (SDNN)", unit: "ms", digits: 0 },
  heart_rate: { label: "Avg heart rate", unit: "bpm", digits: 0 },
  active_energy: { label: "Active energy", unit: "kcal", digits: 0 },
  weight: { label: "Weight", unit: "lb", digits: 1 },
  bp_systolic: { label: "BP systolic", unit: "mmHg", digits: 0 },
  bp_diastolic: { label: "BP diastolic", unit: "mmHg", digits: 0 },
  distance: { label: "Walk + run", unit: "mi", digits: 1 },
  flights: { label: "Flights climbed", unit: "", digits: 0 },
  workout_min: { label: "Workout", unit: "min", digits: 0 },
};
export const healthLabel = (m: string) => HEALTH_LABELS[m]?.label ?? m.replace(/_/g, " ");

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function buildReport(input: {
  items: Item[];
  logs: Log[];
  health: HealthRow[];
  notes: Note[];
  changes: Change[];
  from: string;
  to: string;
  now: string;
}): Report {
  const { items, logs, health, notes, changes, from, now } = input;
  const today = now.slice(0, 10);
  const to = input.to > today ? today : input.to;
  const byId = new Map(items.map((i) => [i.id, i]));
  const logsByDate = new Map<string, Log[]>();
  for (const l of logs) {
    if (l.date < from || l.date > to) continue;
    (logsByDate.get(l.date) ?? logsByDate.set(l.date, []).get(l.date)!).push(l);
  }
  const healthByDate = new Map<string, Record<string, number>>();
  const healthMetrics = new Set<string>();
  for (const h of health) {
    if (h.date < from || h.date > to) continue;
    (healthByDate.get(h.date) ?? healthByDate.set(h.date, {}).get(h.date)!)[h.metric] = h.value;
    healthMetrics.add(h.metric);
  }
  const notesByDate = new Map<string, string[]>();
  for (const n of notes) {
    if (n.date < from || n.date > to) continue;
    (notesByDate.get(n.date) ?? notesByDate.set(n.date, []).get(n.date)!).push(n.text);
  }

  const medAgg = new Map<string, MedSummary & { delays: number[]; prnDaySet: Set<string> }>();
  const medFor = (item: Item) => {
    const k = nameKey(item.name);
    let m = medAgg.get(k);
    if (!m) {
      m = {
        name: item.name, strengths: [], category: item.category, prn: item.prn,
        expected: 0, taken: 0, skipped: 0, missed: 0, pct: null, avgDelayMin: null, onTimePct: null,
        prnCount: 0, prnDays: 0, delays: [], prnDaySet: new Set(),
      };
      medAgg.set(k, m);
    }
    if (item.strength && !m.strengths.includes(item.strength)) m.strengths.push(item.strength);
    if (item.category && !m.category) m.category = item.category;
    return m;
  };
  const trackVals = new Map<string, { item: Item; vals: { date: string; slot: string | null; v: number }[] }>();

  const days: DaySummary[] = [];
  let firstDataDate: string | null = null;
  for (const date of dateRange(from, to)) {
    const dayLogs = logsByDate.get(date) ?? [];
    const entries = entriesForDay(items, dayLogs, date, now);
    const d: DaySummary = {
      date, expected: 0, taken: 0, skipped: 0, missed: 0, adherence: null,
      checkinsExpected: 0, checkinsDone: 0, trackers: {}, prn: {}, prnTotal: 0,
      categoryDoses: {}, missedList: [], skippedList: [], health: healthByDate.get(date) ?? {},
      notes: [...(notesByDate.get(date) ?? [])],
    };
    for (const e of entries) {
      if (e.state === "due" || e.state === "upcoming") continue;
      if (e.item.kind === "med") {
        const m = medFor(e.item);
        d.expected++;
        m.expected++;
        if (e.state === "taken") {
          d.taken++;
          m.taken++;
          if (e.item.category) d.categoryDoses[e.item.category] = (d.categoryDoses[e.item.category] ?? 0) + 1;
          if (e.log && e.log.at.slice(0, 10) === date) {
            m.delays.push(minutesOf(e.log.at.slice(11, 16)) - minutesOf(e.slot));
          }
        } else if (e.state === "skipped") {
          d.skipped++;
          m.skipped++;
          d.skippedList.push(`${e.item.name} ${e.slot}`);
        } else {
          d.missed++;
          m.missed++;
          d.missedList.push(`${e.item.name} ${e.slot}`);
        }
      } else {
        d.checkinsExpected++;
        if (e.state === "recorded") d.checkinsDone++;
      }
    }
    for (const l of dayLogs) {
      const item = byId.get(l.itemId);
      if (!item) continue;
      if (l.note) d.notes.push(`${item.name}: ${l.note}`);
      if (item.kind === "tracker" && l.value != null) {
        const t = trackVals.get(nameKey(item.name)) ?? trackVals.set(nameKey(item.name), { item, vals: [] }).get(nameKey(item.name))!;
        if (item.startDate >= t.item.startDate) t.item = item;
        t.vals.push({ date, slot: l.slot, v: l.value });
        const cur = d.trackers[item.name];
        if (!cur) d.trackers[item.name] = { avg: l.value, max: l.value, min: l.value, n: 1 };
        else {
          cur.avg = (cur.avg * cur.n + l.value) / (cur.n + 1);
          cur.n++;
          cur.max = Math.max(cur.max, l.value);
          cur.min = Math.min(cur.min, l.value);
        }
      } else if (item.kind === "med" && !l.slot && l.status === "taken") {
        const m = medFor(item);
        m.prnCount++;
        m.prnDaySet.add(date);
        d.prn[item.name] = (d.prn[item.name] ?? 0) + 1;
        d.prnTotal++;
        if (item.category) d.categoryDoses[item.category] = (d.categoryDoses[item.category] ?? 0) + 1;
      }
    }
    d.adherence = d.expected ? d.taken / d.expected : null;
    if (!firstDataDate && (dayLogs.length || Object.keys(d.health).length)) firstDataDate = date;
    days.push(d);
  }

  const meds: MedSummary[] = [...medAgg.values()]
    .map(({ delays, prnDaySet, ...m }) => ({
      ...m,
      pct: m.expected ? m.taken / m.expected : null,
      avgDelayMin: delays.length ? Math.round(mean(delays)!) : null,
      onTimePct: delays.length ? delays.filter((x) => Math.abs(x) <= 60).length / delays.length : null,
      prnDays: prnDaySet.size,
    }))
    .sort((a, b) => Number(a.prn && !a.expected) - Number(b.prn && !b.expected) || a.name.localeCompare(b.name));

  const span = Math.max(1, days.length);
  const third = Math.max(1, Math.floor(span / 3));
  const firstEnd = addDays(from, third - 1);
  const lastStart = addDays(to, -(third - 1));
  const trackers: TrackerSummary[] = [...trackVals.values()].map(({ item, vals }) => {
    const all = vals.map((x) => x.v);
    const dayAvg = days.filter((d) => d.trackers[item.name]).map((d) => ({ date: d.date, ...d.trackers[item.name] }));
    const f = mean(dayAvg.filter((d) => d.date <= firstEnd).map((d) => d.avg));
    const l = mean(dayAvg.filter((d) => d.date >= lastStart).map((d) => d.avg));
    let trend: TrackerSummary["trend"] = "n/a";
    if (f != null && l != null && span >= 6) trend = l - f <= -0.5 ? "improving" : l - f >= 0.5 ? "worsening" : "steady";
    const slotMap = new Map<string, number[]>();
    for (const v of vals) {
      const key = v.slot ?? "Extra";
      (slotMap.get(key) ?? slotMap.set(key, []).get(key)!).push(v.v);
    }
    const hi = item.scaleMax * 0.8;
    return {
      name: item.name, color: item.color, scaleMax: item.scaleMax, n: all.length, daysLogged: dayAvg.length,
      mean: round1(mean(all)), min: all.length ? Math.min(...all) : null, max: all.length ? Math.max(...all) : null,
      firstThird: round1(f), lastThird: round1(l), trend,
      bySlot: [...slotMap.entries()].map(([slot, xs]) => ({ slot, mean: round1(mean(xs))!, n: xs.length })).sort((a, b) => a.slot.localeCompare(b.slot)),
      highDays: dayAvg.filter((d) => d.max >= hi).map((d) => ({ date: d.date, max: d.max })),
    };
  });
  trackers.sort((a, b) => a.name.localeCompare(b.name));

  // Exploratory same-day correlations for each tracker.
  const correlations: Correlation[] = [];
  const series: { label: string; get: (d: DaySummary) => number | null }[] = [
    { label: "Dose adherence", get: (d) => d.adherence },
    { label: "As-needed doses", get: (d) => (d.expected || d.prnTotal ? d.prnTotal : null) },
    ...[...healthMetrics].sort().map((m) => ({ label: healthLabel(m), get: (d: DaySummary) => d.health[m] ?? null })),
  ];
  for (const t of trackers) {
    for (const s of series) {
      const xs: number[] = [], ys: number[] = [];
      for (const d of days) {
        const y = d.trackers[t.name]?.avg;
        const x = s.get(d);
        if (y == null || x == null) continue;
        xs.push(x);
        ys.push(y);
      }
      const r = pearson(xs, ys);
      if (r != null) correlations.push({ a: t.name, b: s.label, r: Math.round(r * 100) / 100, n: xs.length });
    }
  }
  for (let i = 0; i < trackers.length; i++)
    for (let j = i + 1; j < trackers.length; j++) {
      const xs: number[] = [], ys: number[] = [];
      for (const d of days) {
        const x = d.trackers[trackers[i].name]?.avg, y = d.trackers[trackers[j].name]?.avg;
        if (x == null || y == null) continue;
        xs.push(x);
        ys.push(y);
      }
      const r = pearson(xs, ys);
      if (r != null) correlations.push({ a: trackers[i].name, b: trackers[j].name, r: Math.round(r * 100) / 100, n: xs.length });
    }

  const sum = (f: (d: DaySummary) => number) => days.reduce((a, d) => a + f(d), 0);
  const expected = sum((d) => d.expected), taken = sum((d) => d.taken);
  return {
    from, to, days, meds, trackers,
    totals: {
      expected, taken, skipped: sum((d) => d.skipped), missed: sum((d) => d.missed),
      adherence: expected ? taken / expected : null,
      checkinsExpected: sum((d) => d.checkinsExpected), checkinsDone: sum((d) => d.checkinsDone),
      prnTotal: sum((d) => d.prnTotal),
      daysWithData: days.filter((d) => d.expected || Object.keys(d.trackers).length).length,
    },
    correlations, healthMetrics: [...healthMetrics].sort(),
    changes: changes.filter((c) => c.date >= from && c.date <= to).sort((a, b) => a.date.localeCompare(b.date)),
    firstDataDate,
  };
}

export const pct = (x: number | null) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
