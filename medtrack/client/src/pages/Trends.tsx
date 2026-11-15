import { useMemo, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download, FileText } from "lucide-react";
import { buildReport, HEALTH_LABELS, healthLabel, pct, round1, type Report } from "@shared/analytics";
import { addDays, diffDays, fmtDay, fmtTime } from "@shared/schedule";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { exportUrl, useAppState, useHealth, useLogs, useNow } from "@/lib/api";
import { tone, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Empty, ErrorNote, fieldCls, Panel, SectionTitle } from "@/components/bits";

type Preset = "7" | "30" | "90" | "all" | "custom";
const PRESETS: { v: Preset; label: string }[] = [
  { v: "7", label: "7 days" }, { v: "30", label: "30 days" }, { v: "90", label: "90 days" }, { v: "all", label: "All" }, { v: "custom", label: "Custom" },
];
const C = { ok: "hsl(var(--ok))", warn: "hsl(var(--warn))", gold: "hsl(var(--gold))", grid: "hsl(var(--border))", text: "hsl(var(--muted-foreground))", skip: "hsl(var(--muted-foreground) / 0.45)" };
const axis = { tick: { fontSize: 11, fill: C.text }, tickLine: false, axisLine: false } as const;

function Tip({ active, payload, label, notes }: any) {
  if (!active || !payload?.length) return null;
  const extra: string[] = notes?.[label] ?? [];
  return (
    <div className="max-w-60 rounded-md border bg-popover px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-semibold">{/^\d{4}-/.test(label) ? fmtDay(label, { weekday: true }) : label}</div>
      {payload.filter((p: any) => p.value != null).map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? p.stroke }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-semibold tabular-nums">{typeof p.value === "number" ? Math.round(p.value * 10) / 10 : p.value}</span>
        </div>
      ))}
      {extra.map((t, i) => <div key={i} className="mt-1 border-t pt-1 text-gold-ink">{t}</div>)}
    </div>
  );
}

function Kpi({ label, value, sub, testid }: { label: string; value: ReactNode; sub?: string; testid: string }) {
  return (
    <Panel className="px-3 py-3" data-testid={testid}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Panel>
  );
}
function ChartCard({ title, note, children, controls }: { title: string; note?: string; children: ReactNode; controls?: ReactNode }) {
  return (
    <Panel className="mt-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        {controls}
      </div>
      <div className="mt-3">{children}</div>
    </Panel>
  );
}
const strength = (r: number) => (Math.abs(r) < 0.2 ? "Little or none" : Math.abs(r) < 0.4 ? "Weak" : Math.abs(r) < 0.6 ? "Moderate" : "Strong");
const selCls = cn(fieldCls, "h-10 w-auto min-w-0 max-w-[11rem] py-0 pr-8 text-sm");

export default function Trends() {
  const now = useNow();
  const today = now.slice(0, 10);
  const { dark } = useTheme();
  const state = useAppState();
  const [preset, setPreset] = useState<Preset>("30");
  const [cFrom, setCFrom] = useState(addDays(today, -13));
  const [cTo, setCTo] = useState(today);
  const [useMax, setUseMax] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [doseSeries, setDoseSeries] = useState<string>("");
  const [doseTracker, setDoseTracker] = useState<string>("");
  const [hMetric, setHMetric] = useState<string>("");
  const [showAll, setShowAll] = useState(false);

  const firstDate = state.data?.firstDate ?? today;
  const to = preset === "custom" ? (cTo > today ? today : cTo) : today;
  const from = preset === "custom" ? (cFrom > to ? to : cFrom) : preset === "all" ? (firstDate < today ? firstDate : today) : addDays(today, -(Number(preset) - 1));
  const logsQ = useLogs(from, to, !!state.data);
  const healthQ = useHealth(from, to, !!state.data);

  const r: Report | null = useMemo(() => {
    if (!state.data || !logsQ.data) return null;
    return buildReport({ items: state.data.items, logs: logsQ.data, health: healthQ.data ?? [], notes: state.data.notes, changes: state.data.changes, from, to, now });
  }, [state.data, logsQ.data, healthQ.data, from, to, now]);

  if (state.isError) return <ErrorNote error={state.error} onRetry={() => state.refetch()} />;
  if (logsQ.isError) return <ErrorNote error={logsQ.error} onRetry={() => logsQ.refetch()} />;

  const params = { from, to, now };
  const header = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Trends</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-range">
            {fmtDay(from, { year: from.slice(0, 4) !== to.slice(0, 4) })} to {fmtDay(to, { year: true })} · {diffDays(to, from) + 1} days
          </p>
        </div>
        <Button asChild className="min-h-11" data-testid="link-report">
          <a href={exportUrl("report.html", { ...params, inline: "1" })} target="_blank" rel="noopener noreferrer">
            <FileText /> Clinician report
          </a>
        </Button>
      </div>
      <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Date range">
        {PRESETS.map((p) => (
          <button key={p.v} type="button" role="tab" aria-selected={preset === p.v} onClick={() => setPreset(p.v)} data-testid={`range-${p.v}`}
            className={cn("h-10 shrink-0 rounded-md border px-3.5 text-sm font-medium", preset === p.v ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground")}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="mt-2 grid max-w-md grid-cols-2 gap-2">
          <input type="date" aria-label="From" value={cFrom} max={today} onChange={(e) => e.target.value && setCFrom(e.target.value)} className={fieldCls} data-testid="input-from" />
          <input type="date" aria-label="To" value={cTo} max={today} onChange={(e) => e.target.value && setCTo(e.target.value)} className={fieldCls} data-testid="input-to" />
        </div>
      )}
    </>
  );

  if (!r)
    return (
      <div aria-busy="true">
        {header}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="mt-3 h-64 w-full" />
        <Skeleton className="mt-3 h-40 w-full" />
      </div>
    );

  const hasData = r.totals.daysWithData > 0 || r.healthMetrics.length > 0;
  const tcolor = (name: string) => tone(r.trackers.find((t) => t.name === name)?.color ?? "#20808D", dark);
  const changeNotes: Record<string, string[]> = {};
  for (const c of r.changes) (changeNotes[c.date] ??= []).push(c.text);
  const dayRows = r.days.map((d) => {
    const row: Record<string, any> = { date: d.date, taken: d.taken, skipped: d.skipped, missed: d.missed };
    for (const t of r.trackers) row[t.name] = d.trackers[t.name] ? round1(useMax ? d.trackers[t.name].max : d.trackers[t.name].avg) : null;
    return row;
  });
  const tickFmt = (d: string) => fmtDay(d);
  const xProps = { dataKey: "date", tickFormatter: tickFmt, minTickGap: 28, ...axis } as const;

  // Dose-class comparison
  const cats = [...new Set(r.days.flatMap((d) => Object.keys(d.categoryDoses)))].sort();
  const seriesOpts = [...cats, ...(r.totals.prnTotal ? ["All as-needed doses"] : [])];
  const series = seriesOpts.includes(doseSeries) ? doseSeries : seriesOpts.find((s) => /benzo/i.test(s)) ?? seriesOpts[0] ?? "";
  const dTracker = r.trackers.some((t) => t.name === doseTracker) ? doseTracker : r.trackers.find((t) => /anx/i.test(t.name))?.name ?? r.trackers[0]?.name ?? "";
  const doseRows = r.days.map((d) => ({
    date: d.date,
    doses: d.expected || d.prnTotal || Object.keys(d.trackers).length ? (series === "All as-needed doses" ? d.prnTotal : d.categoryDoses[series] ?? 0) : null,
    score: d.trackers[dTracker] ? round1(d.trackers[dTracker].avg) : null,
  }));
  // Health overlay
  const metric = r.healthMetrics.includes(hMetric) ? hMetric : r.healthMetrics.includes("sleep_hours") ? "sleep_hours" : r.healthMetrics[0] ?? "";
  const healthRows = r.days.map((d) => ({ date: d.date, metric: d.health[metric] ?? null, score: d.trackers[dTracker] ? round1(d.trackers[dTracker].avg) : null }));
  // Time of day
  const slots = [...new Set(r.trackers.flatMap((t) => t.bySlot.map((b) => b.slot)))].sort();
  const slotRows = slots.map((s) => {
    const row: Record<string, any> = { slot: s === "Extra" ? "Extra" : fmtTime(s) };
    for (const t of r.trackers) row[t.name] = t.bySlot.find((b) => b.slot === s)?.mean ?? null;
    return row;
  });
  const scheduledMeds = r.meds.filter((m) => m.expected > 0);
  const prnMeds = r.meds.filter((m) => m.prnCount > 0);
  const corr = [...r.correlations].sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 10);
  const tableDays = [...r.days].reverse().filter((d) => d.expected || Object.keys(d.trackers).length || d.prnTotal || d.notes.length);
  const lead = r.trackers.find((t) => /anx/i.test(t.name)) ?? r.trackers[0];
  const second = r.trackers.find((t) => t !== lead && /depress/i.test(t.name)) ?? r.trackers.find((t) => t !== lead);
  const trendWord = (t: typeof lead) => (!t || t.trend === "n/a" ? undefined : `${t.trend}: ${t.firstThird} early, ${t.lastThird} recent`);

  return (
    <div>
      {header}
      {!hasData ? (
        <div className="mt-6">
          <Empty title="No entries in this range yet">Log doses and check-ins on the Today tab, or bring in your Medisafe history from the Data tab. Charts fill in as entries arrive.</Empty>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi testid="kpi-adherence" label="Doses taken" value={pct(r.totals.adherence)} sub={`${r.totals.taken} of ${r.totals.expected}, ${r.totals.skipped} skipped, ${r.totals.missed} missed`} />
            {lead && <Kpi testid="kpi-lead" label={`Average ${lead.name.toLowerCase()}`} value={<>{lead.mean}<span className="text-sm font-normal text-muted-foreground"> / {lead.scaleMax}</span></>} sub={trendWord(lead) ?? `${lead.n} entries`} />}
            {second && <Kpi testid="kpi-second" label={`Average ${second.name.toLowerCase().split(" / ")[0]}`} value={<>{second.mean}<span className="text-sm font-normal text-muted-foreground"> / {second.scaleMax}</span></>} sub={trendWord(second) ?? `${second.n} entries`} />}
            <Kpi testid="kpi-checkins" label="Check-ins done" value={r.totals.checkinsExpected ? pct(r.totals.checkinsDone / r.totals.checkinsExpected) : "n/a"} sub={`${r.totals.checkinsDone} of ${r.totals.checkinsExpected} · ${r.totals.prnTotal} as-needed doses`} />
          </div>

          {r.trackers.length > 0 && (
            <ChartCard title="Mood and symptom scores" note={`${useMax ? "Highest" : "Average"} rating each day. Gold lines mark regimen changes.`}
              controls={
                <div className="flex rounded-md border p-0.5 text-xs font-medium">
                  {[["Average", false], ["Peak", true]].map(([l, v]) => (
                    <button key={String(l)} type="button" onClick={() => setUseMax(v as boolean)} aria-pressed={useMax === v} data-testid={`toggle-${String(l).toLowerCase()}`}
                      className={cn("h-9 rounded px-3", useMax === v ? "bg-secondary text-foreground" : "text-muted-foreground")}>{l}</button>
                  ))}
                </div>
              }>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {r.trackers.map((t) => (
                  <button key={t.name} type="button" aria-pressed={!hidden[t.name]} onClick={() => setHidden((h) => ({ ...h, [t.name]: !h[t.name] }))} data-testid={`legend-${t.name}`}
                    className={cn("flex h-9 items-center gap-2 rounded-md border px-2.5 text-xs font-medium", hidden[t.name] && "opacity-45")}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: tcolor(t.name) }} />
                    {t.name}
                  </button>
                ))}
              </div>
              <div className="h-60" data-testid="chart-scores">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dayRows} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis {...xProps} />
                    <YAxis domain={[0, Math.max(10, ...r.trackers.map((t) => t.scaleMax))]} tickCount={6} {...axis} />
                    <Tooltip content={<Tip notes={changeNotes} />} />
                    {r.changes.map((c) => <ReferenceLine key={c.id} x={c.date} stroke={C.gold} strokeDasharray="4 3" strokeWidth={1.5} />)}
                    {r.trackers.filter((t) => !hidden[t.name]).map((t) => (
                      <Line key={t.name} type="monotone" dataKey={t.name} stroke={tcolor(t.name)} strokeWidth={2} dot={r.days.length <= 31 ? { r: 2.5, strokeWidth: 0, fill: tcolor(t.name) } : false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          {r.totals.expected > 0 && (
            <ChartCard title="Scheduled doses each day" note="Taken, skipped on purpose, and not logged.">
              <div className="h-40" data-testid="chart-adherence">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dayRows} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis {...xProps} />
                    <YAxis allowDecimals={false} {...axis} />
                    <Tooltip content={<Tip />} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                    <Bar dataKey="taken" name="Taken" stackId="a" fill={C.ok} isAnimationActive={false} />
                    <Bar dataKey="skipped" name="Skipped" stackId="a" fill={C.skip} isAnimationActive={false} />
                    <Bar dataKey="missed" name="Not logged" stackId="a" fill={C.warn} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          {scheduledMeds.length > 0 && (
            <ChartCard title="By medication" note="Timing is the average gap between the scheduled time and when the dose was logged.">
              <ul className="divide-y">
                {scheduledMeds.map((m) => (
                  <li key={m.name} className="py-2.5" data-testid={`med-stat-${m.name}`}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">{m.name} <span className="font-normal text-muted-foreground">{m.strengths.join(" / ")}</span></span>
                      <span className="shrink-0 tabular-nums"><span className="font-semibold">{pct(m.pct)}</span><span className="text-muted-foreground"> · {m.taken}/{m.expected}</span></span>
                    </div>
                    <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="bg-ok" style={{ width: `${(m.taken / m.expected) * 100}%` }} />
                      <div style={{ width: `${(m.skipped / m.expected) * 100}%`, background: C.skip }} />
                      <div className="bg-warn" style={{ width: `${(m.missed / m.expected) * 100}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {m.skipped > 0 && `${m.skipped} skipped · `}{m.missed > 0 && `${m.missed} not logged · `}
                      {m.avgDelayMin == null ? "No timing data" : `${Math.abs(m.avgDelayMin)} min ${m.avgDelayMin >= 0 ? "after" : "before"} schedule on average, ${pct(m.onTimePct)} within an hour`}
                    </p>
                  </li>
                ))}
              </ul>
              {prnMeds.length > 0 && (
                <p className="mt-2 border-t pt-2 text-sm" data-testid="text-prn-summary">
                  <span className="font-medium">As needed: </span>
                  <span className="text-muted-foreground">{prnMeds.map((m) => `${m.name} ${m.prnCount} dose${m.prnCount === 1 ? "" : "s"} on ${m.prnDays} day${m.prnDays === 1 ? "" : "s"}`).join(" · ")}</span>
                </p>
              )}
            </ChartCard>
          )}

          {slotRows.length > 1 && (
            <ChartCard title="Scores by time of day" note="Average rating at each check-in time.">
              <div className="h-48" data-testid="chart-slots">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={slotRows} margin={{ top: 6, right: 8, left: -22, bottom: 0 }} barGap={2}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="slot" {...axis} />
                    <YAxis domain={[0, 10]} tickCount={6} {...axis} />
                    <Tooltip content={<Tip />} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                    {r.trackers.map((t) => <Bar key={t.name} dataKey={t.name} fill={tcolor(t.name)} radius={[2, 2, 0, 0]} maxBarSize={22} isAnimationActive={false} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          {seriesOpts.length > 0 && dTracker && (
            <ChartCard title="Doses and scores together" note="Bars count doses taken that day for the class you pick. The line is the daily average score."
              controls={
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Medication class" value={series} onChange={(e) => setDoseSeries(e.target.value)} className={selCls} data-testid="select-dose-series">
                    {seriesOpts.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <select aria-label="Tracker" value={dTracker} onChange={(e) => setDoseTracker(e.target.value)} className={selCls} data-testid="select-dose-tracker">
                    {r.trackers.map((t) => <option key={t.name}>{t.name}</option>)}
                  </select>
                </div>
              }>
              <div className="h-52" data-testid="chart-doses">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={doseRows} margin={{ top: 6, right: -18, left: -22, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis {...xProps} />
                    <YAxis yAxisId="l" domain={[0, 10]} tickCount={6} {...axis} />
                    <YAxis yAxisId="r" orientation="right" allowDecimals={false} {...axis} />
                    <Tooltip content={<Tip notes={changeNotes} />} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                    <Bar yAxisId="r" dataKey="doses" name={`${series} doses`} fill={C.gold} fillOpacity={0.55} maxBarSize={18} isAnimationActive={false} />
                    <Line yAxisId="l" type="monotone" dataKey="score" name={dTracker} stroke={tcolor(dTracker)} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          <SectionTitle>Apple Health</SectionTitle>
          {r.healthMetrics.length === 0 ? (
            <Empty title="No Apple Health data in this range">Ask the assistant to sync Apple Health and sleep, steps, heart rate and other daily metrics will appear here next to your scores.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {r.healthMetrics.slice(0, 8).map((m) => {
                  const xs = r.days.map((d) => d.health[m]).filter((v) => v != null);
                  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
                  const dg = HEALTH_LABELS[m]?.digits ?? 1;
                  return <Kpi key={m} testid={`kpi-health-${m}`} label={`${healthLabel(m)} (daily avg)`} value={<>{mean.toLocaleString(undefined, { maximumFractionDigits: dg, minimumFractionDigits: dg })}<span className="text-sm font-normal text-muted-foreground"> {HEALTH_LABELS[m]?.unit}</span></>} sub={`${xs.length} days`} />;
                })}
              </div>
              {dTracker && (
                <ChartCard title={`${healthLabel(metric)} and ${dTracker.toLowerCase()}`} note="Same-day values. Left axis is the score, right axis is the health metric."
                  controls={
                    <div className="flex flex-wrap gap-2">
                      <select aria-label="Health metric" value={metric} onChange={(e) => setHMetric(e.target.value)} className={selCls} data-testid="select-health-metric">
                        {r.healthMetrics.map((m) => <option key={m} value={m}>{healthLabel(m)}</option>)}
                      </select>
                      <select aria-label="Tracker" value={dTracker} onChange={(e) => setDoseTracker(e.target.value)} className={selCls} data-testid="select-health-tracker">
                        {r.trackers.map((t) => <option key={t.name}>{t.name}</option>)}
                      </select>
                    </div>
                  }>
                  <div className="h-52" data-testid="chart-health">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={healthRows} margin={{ top: 6, right: -8, left: -22, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis {...xProps} />
                        <YAxis yAxisId="l" domain={[0, 10]} tickCount={6} {...axis} />
                        <YAxis yAxisId="r" orientation="right" domain={["auto", "auto"]} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10))} {...axis} />
                        <Tooltip content={<Tip />} />
                        <Line yAxisId="r" type="monotone" dataKey="metric" name={healthLabel(metric)} stroke={C.ok} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                        <Line yAxisId="l" type="monotone" dataKey="score" name={dTracker} stroke={tcolor(dTracker)} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                        <Legend iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
              )}
            </>
          )}

          {corr.length > 0 && (
            <ChartCard title="What moves together" note="Same-day correlation from -1 to +1. Exploratory only. It shows what tends to rise and fall together, not what causes what.">
              <ul className="divide-y text-sm">
                {corr.map((c) => (
                  <li key={`${c.a}|${c.b}`} className="flex items-center gap-3 py-2" data-testid={`corr-${c.a}-${c.b}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{c.a} and {c.b.toLowerCase()}</span>
                      <span className="block text-xs text-muted-foreground">
                        {strength(c.r)}{Math.abs(c.r) >= 0.2 ? (c.r > 0 ? ", rise together" : ", move opposite") : ""} · {c.n} days
                      </span>
                    </span>
                    <span className="relative h-1.5 w-20 shrink-0 rounded-full bg-muted">
                      <span className="absolute inset-y-0 rounded-full" style={{ left: c.r >= 0 ? "50%" : `${50 + c.r * 50}%`, width: `${Math.abs(c.r) * 50}%`, background: c.r >= 0 ? C.warn : C.ok }} />
                      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-border" />
                    </span>
                    <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{c.r > 0 ? "+" : ""}{c.r.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </ChartCard>
          )}

          {r.changes.length > 0 && (
            <>
              <SectionTitle>Regimen changes in this range</SectionTitle>
              <Panel className="divide-y">
                {r.changes.map((c) => (
                  <div key={c.id} className="flex gap-3 px-3 py-2.5 text-sm">
                    <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{fmtDay(c.date)}</span>
                    <span>{c.text}</span>
                  </div>
                ))}
              </Panel>
            </>
          )}

          <SectionTitle>Day by day</SectionTitle>
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm" data-testid="table-daily">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 text-right font-medium">Doses</th>
                  {r.trackers.map((t) => <th key={t.name} className="px-2 py-2 text-right font-medium">{t.name.split(" / ")[0]}</th>)}
                  <th className="px-2 py-2 text-right font-medium">As needed</th>
                  <th className="px-3 py-2 font-medium">Skipped, missed, notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(showAll ? tableDays : tableDays.slice(0, 10)).map((d) => (
                  <tr key={d.date} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDay(d.date, { weekday: true })}</td>
                    <td className={cn("px-2 py-2 text-right tabular-nums", d.expected > 0 && d.taken < d.expected && "font-semibold text-warn")}>{d.expected ? `${d.taken}/${d.expected}` : ""}</td>
                    {r.trackers.map((t) => {
                      const x = d.trackers[t.name];
                      return <td key={t.name} className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{x ? <>{round1(x.avg)}<span className="text-muted-foreground"> ({x.max})</span></> : ""}</td>;
                    })}
                    <td className="px-2 py-2 text-right tabular-nums">{d.prnTotal || ""}</td>
                    <td className="min-w-[16rem] px-3 py-2 text-xs text-muted-foreground">
                      {[...d.skippedList.map((s) => `${s.replace(/ (\d\d:\d\d)$/, (_, t) => ` ${fmtTime(t)}`)} skipped`), ...d.missedList.map((s) => `${s.replace(/ (\d\d:\d\d)$/, (_, t) => ` ${fmtTime(t)}`)} not logged`), ...d.notes].join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <p className="mt-1 text-xs text-muted-foreground">Scores show the daily average with the peak in brackets.</p>
          {tableDays.length > 10 && (
            <Button variant="ghost" className="mt-1 min-h-11" onClick={() => setShowAll((s) => !s)} data-testid="button-show-all">
              {showAll ? "Show fewer days" : `Show all ${tableDays.length} days`}
            </Button>
          )}

          <SectionTitle>Export this range</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button asChild variant="outline" className="min-h-12 bg-card" data-testid="link-export-report">
              <a href={exportUrl("report.html", params)} target="_blank" rel="noopener noreferrer"><Download /> Clinician report</a>
            </Button>
            <Button asChild variant="outline" className="min-h-12 bg-card" data-testid="link-export-daily">
              <a href={exportUrl("daily.csv", params)} target="_blank" rel="noopener noreferrer"><Download /> Daily table (CSV)</a>
            </Button>
            <Button asChild variant="outline" className="min-h-12 bg-card" data-testid="link-export-history">
              <a href={exportUrl("medisafe.csv", params)} target="_blank" rel="noopener noreferrer"><Download /> Full entry history (CSV)</a>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
