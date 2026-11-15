import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Item, Schedule } from "@shared/schema";
import { DAY_NAMES, describeItem, fmtDay } from "@shared/schedule";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { nowStamp, todayStr, useWrite } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BottomSheet, Field, fieldCls } from "./bits";

const PILL_COLORS = ["#F4F2EC", "#F2E53A", "#E3C27A", "#F0796B", "#C6101A", "#F29B38", "#7BC47F", "#2AA3F0", "#5B2BD0", "#B8BCC4"];
const TRACK_COLORS = ["#2F6FDB", "#944454", "#A84B2F", "#20808D", "#C4973B", "#6B5BD2", "#4E8B4A", "#5F6B7A"];
const FORMS = ["pill", "caplet", "capsule", "injection", "liquid", "inhaler", "patch", "other"];

interface Form {
  name: string; strength: string; dose: string; form: string; color: string; category: string; prn: boolean; times: string[];
  sched: Schedule["type"]; days: number[]; every: number; anchor: string; scaleMax: number; lowLabel: string; highLabel: string; notes: string;
}
const toForm = (i: Partial<Item> | undefined, kind: "med" | "tracker"): Form => ({
  name: i?.name ?? "", strength: i?.strength ?? "", dose: i?.dose ?? (kind === "med" ? "1 pill" : ""), form: i?.form ?? "pill",
  color: i?.color ?? (kind === "med" ? PILL_COLORS[0] : TRACK_COLORS[3]), category: i?.category ?? "", prn: i?.prn ?? false,
  times: i?.times ?? ["08:00"], sched: i?.schedule?.type ?? "daily",
  days: i?.schedule?.type === "weekdays" ? i.schedule.days : [1],
  every: i?.schedule?.type === "interval" ? i.schedule.every : 2,
  anchor: i?.schedule?.type === "interval" ? i.schedule.anchor : todayStr(),
  scaleMax: i?.scaleMax ?? 10, lowLabel: i?.lowLabel ?? "", highLabel: i?.highLabel ?? "", notes: i?.notes ?? "",
});
const toSchedule = (f: Form): Schedule =>
  f.sched === "weekdays" ? { type: "weekdays", days: [...f.days].sort() } : f.sched === "interval" ? { type: "interval", every: f.every, anchor: f.anchor } : { type: "daily" };
const schedKey = (x: { strength: string; dose: string; prn: boolean; times: string[]; schedule: Schedule }) =>
  JSON.stringify([x.strength.trim(), x.dose.trim(), x.prn, x.prn ? [] : [...new Set(x.times)].sort(), x.schedule]);

export default function ItemEditor({ kind, item, onClose }: { kind: "med" | "tracker"; item?: Item; onClose: () => void }) {
  const [f, setF] = useState<Form>(() => toForm(item, kind));
  const [mode, setMode] = useState<"revise" | "correct">("revise");
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stopping) stopRef.current?.scrollIntoView({ block: "nearest" });
  }, [stopping]);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const today = todayStr();
  const create = useWrite<any>("POST", "/api/items");
  const update = useWrite<any>("PATCH", `/api/items/${item?.id}`);
  const stop = useWrite<any>("POST", `/api/items/${item?.id}/stop`);
  const busy = create.isPending || update.isPending || stop.isPending;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const fail = (e: unknown) => toast({ title: "Not saved", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });

  const body = useMemo(() => ({
    kind, name: f.name.trim(), strength: f.strength, dose: f.dose, form: f.form, color: f.color, category: f.category,
    prn: kind === "med" && f.prn, times: f.prn ? [] : f.times.filter(Boolean), schedule: toSchedule(f),
    scaleMin: 0, scaleMax: f.scaleMax, lowLabel: f.lowLabel, highLabel: f.highLabel, notes: f.notes,
  }), [f, kind]);
  const changed = !!item && schedKey(item) !== schedKey(body);
  const valid = body.name.length > 0 && (body.prn || body.times.length > 0) && (f.sched !== "weekdays" || f.days.length > 0);
  const noun = kind === "med" ? "medication" : "tracker";

  const submit = () => {
    const done = { onSuccess: () => { toast({ title: item ? "Saved" : `Added ${body.name}` }); onClose(); }, onError: fail };
    if (item) update.mutate({ ...body, today, mode }, done);
    else create.mutate({ ...body, today, now: nowStamp() }, done);
  };

  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={item ? `Edit ${item.name}` : `Add ${noun}`}
      description={item ? `Current: ${describeItem(item)}. Started ${fmtDay(item.startDate, { year: true })}.` : undefined}>
      <div className="space-y-4">
        <Field label="Name">
          <input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} className={fieldCls} placeholder={kind === "med" ? "Medication name" : "What you are rating"} data-testid="input-item-name" />
        </Field>
        {kind === "med" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Strength">
                <input value={f.strength} onChange={(e) => set("strength", e.target.value)} maxLength={40} placeholder="0.5 mg" className={fieldCls} data-testid="input-item-strength" />
              </Field>
              <Field label="Each dose">
                <input value={f.dose} onChange={(e) => set("dose", e.target.value)} maxLength={40} placeholder="1 pill" className={fieldCls} data-testid="input-item-dose" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Form">
                <select value={f.form} onChange={(e) => set("form", e.target.value)} className={fieldCls} data-testid="select-item-form">
                  {FORMS.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                </select>
              </Field>
              <Field label="Class (for reports)">
                <input value={f.category} onChange={(e) => set("category", e.target.value)} maxLength={40} placeholder="e.g. Antidepressant" className={fieldCls} data-testid="input-item-category" />
              </Field>
            </div>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-sm font-medium">Take only as needed</span>
              <Switch checked={f.prn} onCheckedChange={(v) => set("prn", v)} data-testid="switch-item-prn" />
            </label>
          </>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Scale 0 to">
              <select value={f.scaleMax} onChange={(e) => set("scaleMax", Number(e.target.value))} className={fieldCls} data-testid="select-item-scale">
                {[3, 4, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="0 means">
              <input value={f.lowLabel} onChange={(e) => set("lowLabel", e.target.value)} maxLength={30} placeholder="None" className={fieldCls} data-testid="input-item-low" />
            </Field>
            <Field label="Top means">
              <input value={f.highLabel} onChange={(e) => set("highLabel", e.target.value)} maxLength={30} placeholder="Severe" className={fieldCls} data-testid="input-item-high" />
            </Field>
          </div>
        )}

        {!f.prn && (
          <>
            <div>
              <span className="mb-1 block text-sm font-medium">{kind === "med" ? "Dose times" : "Check-in times"}</span>
              <div className="space-y-2">
                {f.times.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <input type="time" value={t} onChange={(e) => set("times", f.times.map((x, j) => (j === i ? e.target.value : x)))} className={fieldCls} data-testid={`input-item-time-${i}`} />
                    <button type="button" aria-label="Remove time" disabled={f.times.length === 1} onClick={() => set("times", f.times.filter((_, j) => j !== i))}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-muted-foreground disabled:opacity-40" data-testid={`button-item-time-remove-${i}`}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="ghost" size="sm" className="mt-1 min-h-11" onClick={() => set("times", [...f.times, "12:00"])} data-testid="button-item-time-add">
                <Plus /> Add a time
              </Button>
            </div>
            <Field label="Repeats">
              <select value={f.sched} onChange={(e) => set("sched", e.target.value as Form["sched"])} className={fieldCls} data-testid="select-item-sched">
                <option value="daily">Every day</option>
                <option value="weekdays">Certain days of the week</option>
                <option value="interval">Every few days</option>
              </select>
            </Field>
            {f.sched === "weekdays" && (
              <div className="grid grid-cols-7 gap-1">
                {DAY_NAMES.map((d, i) => {
                  const on = f.days.includes(i);
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => set("days", on ? f.days.filter((x) => x !== i) : [...f.days, i])} data-testid={`button-item-day-${i}`}
                      className={cn("h-11 rounded-md border text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>
                      {d}
                    </button>
                  );
                })}
              </div>
            )}
            {f.sched === "interval" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Every (days)">
                  <input type="number" inputMode="numeric" min={2} max={365} value={f.every} onChange={(e) => set("every", Math.max(2, Math.min(365, Number(e.target.value) || 2)))} className={fieldCls} data-testid="input-item-every" />
                </Field>
                <Field label="Counting from">
                  <input type="date" value={f.anchor} onChange={(e) => set("anchor", e.target.value || today)} className={fieldCls} data-testid="input-item-anchor" />
                </Field>
              </div>
            )}
          </>
        )}

        <div>
          <span className="mb-1 block text-sm font-medium">Color</span>
          <div className="flex flex-wrap gap-2">
            {(kind === "med" ? PILL_COLORS : TRACK_COLORS).map((c) => (
              <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={f.color === c} onClick={() => set("color", c)} data-testid={`swatch-${c.slice(1)}`}
                className={cn("h-9 w-9 rounded-full border border-foreground/20", f.color === c && "ring-2 ring-ring ring-offset-2 ring-offset-background")} style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <Field label="Notes">
          <input value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={500} placeholder="Prescriber instructions, reason, reminders" className={fieldCls} data-testid="input-item-notes" />
        </Field>

        {changed && (
          <fieldset className="rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">The dose or schedule is different</legend>
            {([["revise", "This is a change starting today", "History keeps the old schedule and the change is added to the log."], ["correct", "I am fixing how it was entered", "Nothing is added to the change log."]] as const).map(([v, t, d]) => (
              <label key={v} className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5">
                <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" data-testid={`radio-mode-${v}`} />
                <span className="text-sm"><span className="font-medium">{t}</span><span className="block text-muted-foreground">{d}</span></span>
              </label>
            ))}
          </fieldset>
        )}

        <Button className="min-h-12 w-full" disabled={busy || !valid} onClick={submit} data-testid="button-item-save">
          {item ? "Save" : `Add ${noun}`}
        </Button>

        {item && !stopping && (
          <Button variant="ghost" className="min-h-11 w-full text-destructive" onClick={() => setStopping(true)} data-testid="button-item-stop">
            Stop this {noun}
          </Button>
        )}
        {item && stopping && (
          <div ref={stopRef} className="space-y-3 rounded-md border p-3">
            <p className="text-sm">Stopping keeps all history for reports. You can restart it later from Past items.</p>
            <Field label="Reason (optional)">
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Per prescriber, course finished, side effects" className={fieldCls} data-testid="input-stop-reason" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {([["today", "Stop now"], ["tomorrow", "After today"]] as const).map(([eff, label]) => (
                <Button key={eff} variant={eff === "today" ? "destructive" : "outline"} className="min-h-12" disabled={busy} data-testid={`button-stop-${eff}`}
                  onClick={() => stop.mutate({ today, effective: eff, reason }, { onSuccess: () => { toast({ title: `Stopped ${item.name}` }); onClose(); }, onError: fail })}>
                  {label}
                </Button>
              ))}
            </div>
            <Button variant="ghost" className="min-h-11 w-full" onClick={() => setStopping(false)} data-testid="button-stop-cancel">Keep it</Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
