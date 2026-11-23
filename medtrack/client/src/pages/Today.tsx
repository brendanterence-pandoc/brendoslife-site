import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Minus, NotebookPen, Plus, Trash2 } from "lucide-react";
import type { Item, Log } from "@shared/schema";
import {
  addDays, DAY_NAMES, entriesForDay, fmtDay, fmtStampTime, fmtTime, isActiveOn, minutesOf, MISSED_AFTER_MIN, parseDate, unscheduledForDay, weekday, type Entry,
} from "@shared/schedule";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppState, useLogs, useNow, useSaveLogs, useWrite } from "@/lib/api";
import { useLogTime } from "@/lib/logTime";
import { LogTimeBar } from "@/components/LogTimeBar";
import { tone, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Empty, ErrorNote, ItemIcon, Panel, SectionTitle } from "@/components/bits";
import { CheckinSheet, DoseSheet, ExtraLogSheet, NoteSheet, PrnSheet } from "@/components/sheets";
import { ReminderPrompt } from "@/components/Reminders";

type SheetState =
  | { t: "dose"; entry: Entry }
  | { t: "checkin"; slot: string | null; rows: { item: Item; log: Log | null }[] }
  | { t: "prn"; item: Item }
  | { t: "extra"; item: Item; log: Log }
  | { t: "note" }
  | null;

const isDone = (e: Entry) => e.state === "taken" || e.state === "skipped" || e.state === "recorded";

export default function Today() {
  const now = useNow();
  const today = now.slice(0, 10);
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  const weekStart = addDays(date, -weekday(date));
  const state = useAppState();
  const logsQ = useLogs(addDays(weekStart, -35), addDays(weekStart, 6));
  const [sheet, setSheet] = useState<SheetState>(null);
  const save = useSaveLogs();
  const delNote = useWrite<{ id: number }>("DELETE", (b) => `/api/notes/${b.id}`);
  const { toast } = useToast();
  const { dark } = useTheme();
  const logTime = useLogTime();

  const items = state.data?.items ?? [];
  const logs = logsQ.data ?? [];
  const future = date > today;

  const { groups, extras, counts } = useMemo(() => {
    const dayLogs = logs.filter((l) => l.date === date);
    const entries = entriesForDay(items, dayLogs, date, now);
    const bySlot = new Map<string, Entry[]>();
    for (const e of entries) (bySlot.get(e.slot) ?? bySlot.set(e.slot, []).get(e.slot)!).push(e);
    const meds = entries.filter((e) => e.item.kind === "med");
    const trk = entries.filter((e) => e.item.kind === "tracker");
    return {
      groups: [...bySlot.entries()].map(([slot, es]) => ({ slot, meds: es.filter((e) => e.item.kind === "med"), trackers: es.filter((e) => e.item.kind === "tracker") })),
      extras: unscheduledForDay(items, dayLogs, date),
      counts: { meds: meds.length, medsDone: meds.filter((e) => e.state === "taken").length, medsSkipped: meds.filter((e) => e.state === "skipped").length, trk: trk.length, trkDone: trk.filter(isDone).length },
    };
  }, [items, logs, date, now]);

  const week = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        const es = d > today ? [] : entriesForDay(items, logs.filter((l) => l.date === d), d, now).filter((e) => e.state !== "upcoming");
        const done = es.filter(isDone).length;
        return { d, status: !es.length ? "none" : done === es.length ? "full" : done > 0 ? "part" : es.some((e) => e.state === "missed") ? "miss" : "none" };
      }),
    [items, logs, weekStart, today, now],
  );

  const prnItems = items.filter((i) => i.kind === "med" && i.prn && isActiveOn(i, date));
  const activeTrackers = items.filter((i) => i.kind === "tracker" && isActiveOn(i, date));
  const dayNotes = (state.data?.notes ?? []).filter((n) => n.date === date);
  const lastPrn = (id: number) => logs.filter((l) => l.itemId === id && !l.slot && l.status === "taken").sort((a, b) => b.at.localeCompare(a.at));
  const fail = (e: unknown) => toast({ title: "Not saved", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });

  const stampNow = (slot: string) => logTime.stampFor(date, slot);
  const quickTake = (e: Entry) => save.mutate([{ itemId: e.item.id, date, slot: e.slot, status: "taken", at: stampNow(e.slot) }], { onError: fail });
  const takeAll = (es: Entry[]) =>
    save.mutate(es.filter((e) => !e.log).map((e) => ({ itemId: e.item.id, date, slot: e.slot, status: "taken" as const, at: stampNow(e.slot) })), { onError: fail });

  if (state.isError) return <ErrorNote error={state.error} onRetry={() => state.refetch()} />;

  const total = counts.meds + counts.trk;
  const done = counts.medsDone + counts.medsSkipped + counts.trkDone;

  return (
    <div className="mx-auto max-w-2xl">
      <ReminderPrompt />
      {!future && <LogTimeBar date={date} today={today} />}
      {/* Day header + week strip */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-day-title">
            {date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : DAY_NAMES[weekday(date)]}
            <span className="font-normal text-muted-foreground">, {fmtDay(date)}</span>
          </h1>
        </div>
        <div className="flex items-center">
          {date !== today && (
            <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setPicked(null)} data-testid="button-go-today">
              Go to today
            </Button>
          )}
          <button type="button" aria-label="Previous week" className="flex h-11 w-9 items-center justify-center text-muted-foreground" onClick={() => setPicked(addDays(date, -7))} data-testid="button-prev-week">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Next week" className="flex h-11 w-9 items-center justify-center text-muted-foreground" onClick={() => setPicked(addDays(date, 7))} data-testid="button-next-week">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1" role="tablist" aria-label="Day of week">
        {week.map(({ d, status }) => {
          const on = d === date;
          return (
            <button key={d} type="button" role="tab" aria-selected={on} onClick={() => setPicked(d === today ? null : d)} data-testid={`day-${d}`}
              className={cn("flex h-16 flex-col items-center justify-center rounded-md border text-sm", on ? "border-primary bg-primary text-primary-foreground" : "border-transparent text-foreground hover:bg-secondary", d === today && !on && "border-border")}>
              <span className={cn("text-xs", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{DAY_NAMES[parseDate(d).getDay()]}</span>
              <span className="font-semibold tabular-nums">{parseDate(d).getDate()}</span>
              <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full",
                status === "full" ? (on ? "bg-primary-foreground" : "bg-ok") : status === "part" ? "bg-gold" : status === "miss" ? "bg-warn" : "bg-transparent")} />
            </button>
          );
        })}
      </div>

      {state.isLoading || logsQ.isLoading ? (
        <div className="mt-6 space-y-3" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : logsQ.isError ? (
        <div className="mt-6"><ErrorNote error={logsQ.error} onRetry={() => logsQ.refetch()} /></div>
      ) : (
        <>
          {total > 0 && (
            <Panel className="mt-4 px-4 py-3" data-testid="card-progress">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                <span>
                  <span className="text-base font-semibold tabular-nums">{counts.medsDone}</span>
                  <span className="text-muted-foreground"> of {counts.meds} doses taken</span>
                  {counts.medsSkipped > 0 && <span className="text-muted-foreground">, {counts.medsSkipped} skipped</span>}
                </span>
                <span className="whitespace-nowrap text-right">
                  <span className="text-base font-semibold tabular-nums">{counts.trkDone}</span>
                  <span className="text-muted-foreground"> of {counts.trk} check-ins</span>
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
                <div className="h-full rounded-full bg-ok transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
              </div>
            </Panel>
          )}

          {groups.length === 0 && (
            <div className="mt-6">
              <Empty title="Nothing scheduled this day">Add medications and trackers on the Regimen tab, or tell the assistant what to add.</Empty>
            </div>
          )}

          {groups.map((g) => {
            const all = [...g.meds, ...g.trackers];
            const open = g.meds.filter((e) => !e.log);
            const label = all.every(isDone) ? "Done" : all.some((e) => e.state === "due") ? (minutesOf(now.slice(11, 16)) - minutesOf(g.slot) >= MISSED_AFTER_MIN ? "Earlier today" : "Due now") : all.some((e) => e.state === "missed") ? "Overdue" : "";
            return (
              <section key={g.slot} data-testid={`slot-${g.slot}`}>
                <div className="mb-2 mt-6 flex min-h-11 items-center justify-between gap-3">
                  <h2 className="flex items-baseline gap-2">
                    <span className="text-lg font-semibold tabular-nums tracking-tight">{fmtTime(g.slot)}</span>
                    {label && (
                      <span className={cn("text-xs font-semibold uppercase tracking-wider", label === "Done" ? "text-ok" : label === "Due now" || label === "Earlier today" ? "text-gold-ink" : "text-warn")}>{label}</span>
                    )}
                  </h2>
                  {!future && open.length > 1 && (
                    <Button variant="outline" size="sm" className="min-h-11" disabled={save.isPending} onClick={() => takeAll(g.meds)} data-testid={`button-take-all-${g.slot}`}>
                      Take all {open.length}
                    </Button>
                  )}
                </div>
                {g.meds.length > 0 && (
                  <Panel className="divide-y">
                    {g.meds.map((e) => (
                      <div key={e.item.id} className="flex items-center gap-3 pl-3 pr-2">
                        <button type="button" className="flex min-h-16 flex-1 items-center gap-3 py-2 text-left" onClick={() => setSheet({ t: "dose", entry: e })} data-testid={`row-dose-${e.item.id}-${e.slot}`}>
                          <ItemIcon item={e.item} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{e.item.name}</span>
                            <span className="block truncate text-sm text-muted-foreground">
                              {[e.item.strength, e.item.dose].filter(Boolean).join(" · ")}
                            </span>
                            {(e.log || e.state === "missed") && (
                              <span className={cn("block text-xs font-medium", e.state === "taken" ? "text-ok" : e.state === "skipped" ? "text-muted-foreground" : "text-warn")}>
                                {e.state === "taken" ? `Taken ${fmtStampTime(e.log!.at)}` : e.state === "skipped" ? "Skipped" : e.log ? "Missed" : "Not logged"}
                                {e.log?.note ? ` · ${e.log.note}` : ""}
                              </span>
                            )}
                          </span>
                        </button>
                        <button type="button" disabled={future || save.isPending}
                          aria-label={e.log ? `Edit ${e.item.name}` : `Mark ${e.item.name} taken`}
                          onClick={() => (e.log ? setSheet({ t: "dose", entry: e }) : quickTake(e))}
                          data-testid={`check-${e.item.id}-${e.slot}`}
                          className="flex h-12 w-12 shrink-0 items-center justify-center disabled:opacity-40">
                          <span className={cn("flex h-8 w-8 items-center justify-center rounded-full border-2",
                            e.state === "taken" ? "border-ok bg-ok text-background" : e.state === "skipped" ? "border-muted-foreground/50 text-muted-foreground" : e.state === "missed" ? "border-warn/70" : "border-input")}>
                            {e.state === "taken" ? <Check className="h-4 w-4" strokeWidth={3} /> : e.state === "skipped" ? <Minus className="h-4 w-4" /> : null}
                          </span>
                        </button>
                      </div>
                    ))}
                  </Panel>
                )}
                {g.trackers.length > 0 && (
                  <Panel className={cn("divide-y", g.meds.length > 0 && "mt-2")}>
                    {g.trackers.map((e) => (
                      <button key={e.item.id} type="button" disabled={future}
                        onClick={() => setSheet({ t: "checkin", slot: g.slot, rows: g.trackers.map((x) => ({ item: x.item, log: x.log })) })}
                        data-testid={`row-track-${e.item.id}-${e.slot}`}
                        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-60">
                        <ItemIcon item={e.item} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{e.item.name}</span>
                          <span className={cn("block truncate text-sm", e.state === "missed" ? "text-warn" : "text-muted-foreground")}>
                            {e.log ? e.log.note || `Rated ${fmtStampTime(e.log.at)}` : e.state === "missed" ? "Not rated" : "Tap to rate"}
                          </span>
                        </span>
                        {e.log?.value != null ? (
                          <span className="flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-base font-semibold tabular-nums"
                            style={{ backgroundColor: `${tone(e.item.color, dark)}22`, color: tone(e.item.color, dark) }} data-testid={`score-${e.item.id}-${e.slot}`}>
                            {e.log.value}
                          </span>
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                    ))}
                  </Panel>
                )}
              </section>
            );
          })}

          {prnItems.length > 0 && (
            <section>
              <SectionTitle>As needed</SectionTitle>
              <Panel className="divide-y">
                {prnItems.map((item) => {
                  const hist = lastPrn(item.id);
                  const n = hist.filter((l) => l.date === date).length;
                  return (
                    <button key={item.id} type="button" disabled={future} onClick={() => setSheet({ t: "prn", item })} data-testid={`row-prn-${item.id}`}
                      className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-60">
                      <ItemIcon item={item} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.name}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {item.strength}
                          {hist[0] ? ` · last ${hist[0].date === today ? "today" : fmtDay(hist[0].date)} ${fmtStampTime(hist[0].at)}` : " · none in the past 5 weeks"}
                        </span>
                      </span>
                      {n > 0 && <span className="rounded-md bg-secondary px-2 py-1 text-xs font-semibold tabular-nums" data-testid={`prn-count-${item.id}`}>{n} {date === today ? "today" : "that day"}</span>}
                      <Plus className="h-5 w-5 text-muted-foreground" />
                    </button>
                  );
                })}
              </Panel>
            </section>
          )}

          <section>
            <SectionTitle>Anytime</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="min-h-12 bg-card" disabled={future || !activeTrackers.length} data-testid="button-extra-checkin"
                onClick={() => setSheet({ t: "checkin", slot: null, rows: activeTrackers.map((item) => ({ item, log: null })) })}>
                <Plus /> Extra check-in
              </Button>
              <Button variant="outline" className="min-h-12 bg-card" onClick={() => setSheet({ t: "note" })} data-testid="button-diary">
                <NotebookPen /> Diary note
              </Button>
            </div>
            {(extras.some((x) => x.item.kind === "tracker") || dayNotes.length > 0) && (
              <Panel className="mt-2 divide-y">
                {extras.filter((x) => x.item.kind === "tracker").map(({ item, log }) => (
                  <button key={log.id} type="button" onClick={() => setSheet({ t: "extra", item, log })} data-testid={`row-extra-${log.id}`}
                    className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm">
                    <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{fmtStampTime(log.at)}</span>
                    <span className="min-w-0 flex-1 truncate">{item.name}{log.note ? ` · ${log.note}` : ""}</span>
                    <span className="font-semibold tabular-nums" style={{ color: tone(item.color, dark) }}>{log.value}</span>
                  </button>
                ))}
                {dayNotes.map((n) => (
                  <div key={`n${n.id}`} className="flex items-start gap-3 py-1 pl-3 pr-1 text-sm">
                    <span className="w-16 shrink-0 pt-2.5 tabular-nums text-muted-foreground">{fmtStampTime(n.at)}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap py-2.5" data-testid={`text-note-${n.id}`}>{n.text}</span>
                    <button type="button" aria-label="Delete note" className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
                      onClick={() => delNote.mutate({ id: n.id }, { onError: fail })} data-testid={`button-note-delete-${n.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </Panel>
            )}
          </section>
        </>
      )}

      {sheet?.t === "dose" && <DoseSheet entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.t === "checkin" && <CheckinSheet date={date} slot={sheet.slot} rows={sheet.rows} onClose={() => setSheet(null)} />}
      {sheet?.t === "prn" && <PrnSheet item={sheet.item} date={date} recent={lastPrn(sheet.item.id)} onClose={() => setSheet(null)} />}
      {sheet?.t === "extra" && <ExtraLogSheet item={sheet.item} log={sheet.log} onClose={() => setSheet(null)} />}
      {sheet?.t === "note" && <NoteSheet date={date} onClose={() => setSheet(null)} />}
    </div>
  );
}
