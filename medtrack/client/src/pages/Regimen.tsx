import { useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import type { Item } from "@shared/schema";
import { describeItem, describeSchedule, fmtDay, fmtTime, isActiveOn, nameKey } from "@shared/schedule";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { nowStamp, todayStr, useAppState, useWrite } from "@/lib/api";
import { BottomSheet, Empty, ErrorNote, Field, fieldCls, ItemIcon, Panel, SectionTitle } from "@/components/bits";
import ItemEditor from "@/components/ItemEditor";
import { cn } from "@/lib/utils";

type Sheet = { t: "edit"; item: Item } | { t: "new"; kind: "med" | "tracker" } | { t: "past"; item: Item } | { t: "change" } | null;

function Row({ item, onClick, sub }: { item: Item; onClick: () => void; sub?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left" data-testid={`row-item-${item.id}`}>
      <ItemIcon item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {item.name} {item.strength && <span className="font-normal text-muted-foreground">{item.strength}</span>}
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {item.endDate && !sub ? `Ends ${fmtDay(item.endDate)} · ` : ""}{sub ?? (item.prn ? "As needed" : item.times.length ? `${item.times.map(fmtTime).join(", ")}${item.schedule.type === "daily" ? "" : ` · ${describeSchedule(item.schedule)}`}` : "No schedule")}
        </span>
        {item.category && <span className="block truncate text-xs text-muted-foreground/80">{item.category}</span>}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

export default function Regimen() {
  const state = useAppState();
  const [sheet, setSheet] = useState<Sheet>(null);
  const today = todayStr();
  const { toast } = useToast();
  const restart = useWrite<{ id: number; today: string; now: string }>("POST", (b) => `/api/items/${b.id}/restart`);
  const remove = useWrite<{ id: number }>("DELETE", (b) => `/api/items/${b.id}`);
  const addChange = useWrite<{ date: string; text: string }>("POST", "/api/changes");
  const delChange = useWrite<{ id: number }>("DELETE", (b) => `/api/changes/${b.id}`);
  const [chDate, setChDate] = useState(today);
  const [chText, setChText] = useState("");
  const fail = (e: unknown) => toast({ title: "Not saved", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });

  if (state.isError) return <ErrorNote error={state.error} onRetry={() => state.refetch()} />;
  if (state.isLoading || !state.data)
    return (
      <div className="mx-auto max-w-2xl space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  const items = state.data.items;
  const active = items.filter((i) => isActiveOn(i, today) || (i.startDate > today && !(i.endDate && i.endDate < i.startDate)));
  const meds = active.filter((i) => i.kind === "med" && !i.prn);
  const prn = active.filter((i) => i.kind === "med" && i.prn);
  const trackers = active.filter((i) => i.kind === "tracker");
  const span = (i: Item) => (i.endDate! < i.startDate ? `Stopped ${fmtDay(i.startDate, { year: true })}` : `${fmtDay(i.startDate)} to ${fmtDay(i.endDate!, { year: true })}`);
  const past = items.filter((i) => i.endDate && (i.endDate < today || i.endDate < i.startDate)).sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
  const hasActive = (i: Item) => active.some((a) => a.kind === i.kind && nameKey(a.name) === nameKey(i.name));
  const dosesPerDay = meds.filter((m) => m.schedule.type === "daily").reduce((n, m) => n + m.times.length, 0);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Regimen</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-regimen-summary">
            {meds.length + prn.length} medications, {dosesPerDay} scheduled doses a day, {trackers.length} trackers
          </p>
        </div>
      </div>

      <SectionTitle action={<Button variant="outline" size="sm" className="min-h-11 bg-card" onClick={() => setSheet({ t: "new", kind: "med" })} data-testid="button-add-med"><Plus /> Add</Button>}>
        Scheduled medications
      </SectionTitle>
      {meds.length ? <Panel className="divide-y">{meds.map((i) => <Row key={i.id} item={i} onClick={() => setSheet({ t: "edit", item: i })} />)}</Panel> : <Empty title="No scheduled medications" />}

      {prn.length > 0 && (
        <>
          <SectionTitle>As needed</SectionTitle>
          <Panel className="divide-y">{prn.map((i) => <Row key={i.id} item={i} onClick={() => setSheet({ t: "edit", item: i })} />)}</Panel>
        </>
      )}

      <SectionTitle action={<Button variant="outline" size="sm" className="min-h-11 bg-card" onClick={() => setSheet({ t: "new", kind: "tracker" })} data-testid="button-add-tracker"><Plus /> Add</Button>}>
        Mood and symptom trackers
      </SectionTitle>
      {trackers.length ? <Panel className="divide-y">{trackers.map((i) => <Row key={i.id} item={i} onClick={() => setSheet({ t: "edit", item: i })} />)}</Panel> : <Empty title="No trackers yet" />}

      {past.length > 0 && (
        <>
          <SectionTitle>Past items</SectionTitle>
          <Panel className="divide-y">
            {past.map((i) => (
              <Row key={i.id} item={i} onClick={() => setSheet({ t: "past", item: i })}
                sub={`${i.prn ? "As needed" : i.times.length ? describeItem({ ...i, strength: "" }) : "History only"} · ${span(i)}`} />
            ))}
          </Panel>
        </>
      )}

      <SectionTitle action={<Button variant="outline" size="sm" className="min-h-11 bg-card" onClick={() => setSheet({ t: "change" })} data-testid="button-add-change"><Plus /> Add</Button>}>
        Change log
      </SectionTitle>
      {state.data.changes.length ? (
        <Panel className="divide-y">
          {state.data.changes.map((c) => (
            <div key={c.id} className="flex items-start gap-3 py-1 pl-3 pr-1 text-sm" data-testid={`row-change-${c.id}`}>
              <span className="w-20 shrink-0 pt-2.5 tabular-nums text-muted-foreground">{fmtDay(c.date)}</span>
              <span className="min-w-0 flex-1 py-2.5">{c.text}</span>
              <button type="button" aria-label="Delete entry" className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
                onClick={() => delChange.mutate({ id: c.id }, { onError: fail })} data-testid={`button-change-delete-${c.id}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </Panel>
      ) : (
        <Empty title="No changes recorded">Starts, stops and dose changes are added here automatically and marked on the charts.</Empty>
      )}

      {sheet?.t === "edit" && <ItemEditor kind={sheet.item.kind} item={sheet.item} onClose={() => setSheet(null)} />}
      {sheet?.t === "new" && <ItemEditor kind={sheet.kind} onClose={() => setSheet(null)} />}
      {sheet?.t === "past" && (
        <BottomSheet open onOpenChange={(o) => !o && setSheet(null)} title={`${sheet.item.name}${sheet.item.strength ? ` ${sheet.item.strength}` : ""}`}
          description={`${span(sheet.item)}. History stays in reports.`}>
          <div className="space-y-2">
            {!hasActive(sheet.item) && (
              <Button className="min-h-12 w-full" disabled={restart.isPending} data-testid="button-restart"
                onClick={() => restart.mutate({ id: sheet.item.id, today, now: nowStamp() }, { onSuccess: () => { toast({ title: `Restarted ${sheet.item.name}` }); setSheet(null); }, onError: fail })}>
                Restart today{sheet.item.times.length || sheet.item.prn ? " with the same schedule" : ""}
              </Button>
            )}
            <Button variant="outline" className={cn("min-h-12 w-full")} disabled={remove.isPending} data-testid="button-delete-item"
              onClick={() => remove.mutate({ id: sheet.item.id }, { onSuccess: () => setSheet(null), onError: fail })}>
              Delete (only if it has no history)
            </Button>
          </div>
        </BottomSheet>
      )}
      {sheet?.t === "change" && (
        <BottomSheet open onOpenChange={(o) => !o && setSheet(null)} title="Add to change log" description="For changes the app cannot see, such as a new prescriber, a brand switch, or an illness.">
          <div className="space-y-4">
            <Field label="Date">
              <input type="date" value={chDate} onChange={(e) => setChDate(e.target.value || today)} className={fieldCls} data-testid="input-change-date" />
            </Field>
            <Field label="What changed">
              <input value={chText} onChange={(e) => setChText(e.target.value)} maxLength={500} className={fieldCls} data-testid="input-change-text" />
            </Field>
            <Button className="min-h-12 w-full" disabled={addChange.isPending || !chText.trim()} data-testid="button-change-save"
              onClick={() => addChange.mutate({ date: chDate, text: chText }, { onSuccess: () => { setChText(""); setSheet(null); }, onError: fail })}>
              Add entry
            </Button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
