// Bottom sheets used on the Today screen: dose detail, check-in ratings, as-needed dose, extra entry edit, diary note.
import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Item, Log } from "@shared/schema";
import { fmtDay, fmtStampTime, fmtTime, type Entry } from "@shared/schedule";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { nowStamp, useDeleteLog, useSaveLogs, useUpdateLog, useWrite, type NewLog } from "@/lib/api";
import { tone, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { BottomSheet, Field, fieldCls } from "./bits";

const stampFor = (date: string, time: string) => `${date}T${time}`;
/** Default time for a new entry: the current time when logging today, otherwise the scheduled time. */
const defaultTime = (date: string, slot: string | null) => {
  const now = nowStamp();
  return date === now.slice(0, 10) ? now.slice(11, 16) : slot ?? "12:00";
};

function useFail() {
  const { toast } = useToast();
  return (e: unknown) => toast({ title: "Not saved", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
}

// ── Scheduled dose ───────────────────────────────────────────────────────────
export function DoseSheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const { item, log, slot, date } = entry;
  const [time, setTime] = useState(log ? log.at.slice(11, 16) : defaultTime(date, slot));
  const [note, setNote] = useState(log?.note ?? "");
  const save = useSaveLogs();
  const del = useDeleteLog();
  const fail = useFail();
  const busy = save.isPending || del.isPending;
  const put = (status: "taken" | "skipped") =>
    save.mutate([{ itemId: item.id, date, slot, status, at: stampFor(log && log.at.slice(0, 10) !== date ? log.at.slice(0, 10) : date, time), note }], { onSuccess: onClose, onError: fail });
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={`${item.name}${item.strength ? ` ${item.strength}` : ""}`}
      description={`${item.dose ? `${item.dose}, ` : ""}scheduled ${fmtTime(slot)} on ${fmtDay(date, { weekday: true })}`}>
      <div className="space-y-4">
        {log && (
          <p className="text-sm" data-testid="text-dose-status">
            <span className={cn("font-medium", log.status === "taken" ? "text-ok" : "text-warn")}>
              {log.status === "taken" ? "Taken" : log.status === "skipped" ? "Skipped" : "Missed"}
            </span>
            {log.status === "taken" && <span className="text-muted-foreground"> at {fmtStampTime(log.at)}</span>}
            {log.source === "medisafe" && <span className="text-muted-foreground"> · imported from Medisafe</span>}
          </p>
        )}
        {item.notes && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{item.notes}</p>}
        <Field label="Time taken">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={fieldCls} data-testid="input-dose-time" />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Side effect, reason for skipping, anything useful" className={fieldCls} data-testid="input-dose-note" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button className="min-h-12" disabled={busy || !time} onClick={() => put("taken")} data-testid="button-dose-taken">
            {log?.status === "taken" ? "Save changes" : "Mark taken"}
          </Button>
          <Button variant="outline" className="min-h-12" disabled={busy || !time} onClick={() => put("skipped")} data-testid="button-dose-skipped">
            {log?.status === "skipped" ? "Save as skipped" : "Mark skipped"}
          </Button>
        </div>
        {log && (
          <Button variant="ghost" className="min-h-11 w-full text-muted-foreground" disabled={busy}
            onClick={() => del.mutate(log.id, { onSuccess: onClose, onError: fail })} data-testid="button-dose-clear">
            Clear this entry
          </Button>
        )}
      </div>
    </BottomSheet>
  );
}

// ── Ratings (one sheet per check-in time, covering every tracker due then) ───
export function ScalePicker({ item, value, onChange }: { item: Item; value: number | null; onChange: (v: number | null) => void }) {
  const { dark } = useTheme();
  const c = tone(item.color, dark);
  const nums = Array.from({ length: item.scaleMax - item.scaleMin + 1 }, (_, i) => item.scaleMin + i);
  return (
    <div>
      <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label={`${item.name} rating`}>
        {nums.map((n) => {
          const on = value === n;
          return (
            <button key={n} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? null : n)}
              data-testid={`rate-${item.id}-${n}`}
              className={cn("h-12 rounded-md border text-base font-semibold tabular-nums", !on && "border-border bg-background text-foreground")}
              style={on ? { backgroundColor: c, borderColor: c, color: dark ? "#0C1220" : "#fff" } : undefined}>
              {n}
            </button>
          );
        })}
      </div>
      {(item.lowLabel || item.highLabel) && (
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{item.scaleMin} {item.lowLabel}</span>
          <span>{item.scaleMax} {item.highLabel}</span>
        </div>
      )}
    </div>
  );
}

export function CheckinSheet({
  date, slot, rows, onClose,
}: { date: string; slot: string | null; rows: { item: Item; log: Log | null }[]; onClose: () => void }) {
  const [vals, setVals] = useState<Record<number, number | null>>(() => Object.fromEntries(rows.map((r) => [r.item.id, r.log?.value ?? null])));
  const [notes, setNotes] = useState<Record<number, string>>(() => Object.fromEntries(rows.map((r) => [r.item.id, r.log?.note ?? ""])));
  const [noteOpen, setNoteOpen] = useState<Record<number, boolean>>(() => Object.fromEntries(rows.map((r) => [r.item.id, !!r.log?.note])));
  const [time, setTime] = useState(defaultTime(date, slot));
  const save = useSaveLogs();
  const del = useDeleteLog();
  const fail = useFail();
  const busy = save.isPending || del.isPending;
  const any = rows.some((r) => vals[r.item.id] != null || r.log);

  const submit = async () => {
    try {
      const logs: NewLog[] = [];
      for (const r of rows) {
        const v = vals[r.item.id];
        if (v == null) {
          if (r.log) await del.mutateAsync(r.log.id);
          continue;
        }
        logs.push({
          itemId: r.item.id, date, slot, status: "recorded", value: v, note: notes[r.item.id] ?? "",
          at: slot ? r.log?.at ?? stampFor(date, defaultTime(date, slot)) : stampFor(date, time),
        });
      }
      if (logs.length) await save.mutateAsync(logs);
      onClose();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={slot ? `${fmtTime(slot)} check-in` : "Check-in now"}
      description={`${fmtDay(date, { weekday: true })}. Tap a number for each. Tap it again to clear.`}>
      <div className="space-y-5">
        {!slot && (
          <Field label="Time">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={fieldCls} data-testid="input-checkin-time" />
          </Field>
        )}
        {rows.map(({ item }) => (
          <div key={item.id}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{item.name}</span>
              <button type="button" className="min-h-9 text-sm font-medium text-primary" data-testid={`button-note-${item.id}`}
                onClick={() => setNoteOpen((s) => ({ ...s, [item.id]: !s[item.id] }))}>
                {noteOpen[item.id] ? "Hide note" : "Add note"}
              </button>
            </div>
            <ScalePicker item={item} value={vals[item.id]} onChange={(v) => setVals((s) => ({ ...s, [item.id]: v }))} />
            {noteOpen[item.id] && (
              <input value={notes[item.id] ?? ""} maxLength={500} placeholder={`Note about ${item.name.toLowerCase()}`} className={cn(fieldCls, "mt-2")}
                onChange={(e) => setNotes((s) => ({ ...s, [item.id]: e.target.value }))} data-testid={`input-note-${item.id}`} />
            )}
          </div>
        ))}
        <Button className="min-h-12 w-full" disabled={busy || !any} onClick={submit} data-testid="button-checkin-save">
          Save check-in
        </Button>
      </div>
    </BottomSheet>
  );
}

// ── As-needed dose ───────────────────────────────────────────────────────────
export function PrnSheet({ item, date, recent, onClose }: { item: Item; date: string; recent: Log[]; onClose: () => void }) {
  const [time, setTime] = useState(defaultTime(date, null));
  const [note, setNote] = useState("");
  const save = useSaveLogs();
  const del = useDeleteLog();
  const fail = useFail();
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={`${item.name}${item.strength ? ` ${item.strength}` : ""}`}
      description={`As needed${item.dose ? `, ${item.dose}` : ""}. Logging for ${fmtDay(date, { weekday: true })}.`}>
      <div className="space-y-4">
        {item.notes && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{item.notes}</p>}
        <Field label="Time taken">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={fieldCls} data-testid="input-prn-time" />
        </Field>
        <Field label="Reason or note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What prompted it" className={fieldCls} data-testid="input-prn-note" />
        </Field>
        <Button className="min-h-12 w-full" disabled={save.isPending || !time} data-testid="button-prn-save"
          onClick={() => save.mutate([{ itemId: item.id, date, slot: null, status: "taken", at: stampFor(date, time), note }], { onSuccess: onClose, onError: fail })}>
          Log dose
        </Button>
        {recent.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent doses</p>
            <ul className="divide-y">
              {recent.slice(0, 6).map((l) => (
                <li key={l.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
                  <span>
                    {fmtDay(l.date, { weekday: true })}, {fmtStampTime(l.at)}
                    {l.note && <span className="text-muted-foreground"> · {l.note}</span>}
                  </span>
                  <button type="button" aria-label="Delete dose" className="flex h-11 w-11 items-center justify-center text-muted-foreground"
                    onClick={() => del.mutate(l.id, { onError: fail })} data-testid={`button-prn-delete-${l.id}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

// ── Edit an unscheduled entry (extra rating) ────────────────────────────────
export function ExtraLogSheet({ item, log, onClose }: { item: Item; log: Log; onClose: () => void }) {
  const [time, setTime] = useState(log.at.slice(11, 16));
  const [value, setValue] = useState<number | null>(log.value);
  const [note, setNote] = useState(log.note);
  const upd = useUpdateLog();
  const del = useDeleteLog();
  const fail = useFail();
  const busy = upd.isPending || del.isPending;
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={item.name} description={`Entry on ${fmtDay(log.date, { weekday: true })}`}>
      <div className="space-y-4">
        <Field label="Time">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={fieldCls} data-testid="input-extra-time" />
        </Field>
        {item.kind === "tracker" && <ScalePicker item={item} value={value} onChange={setValue} />}
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={fieldCls} data-testid="input-extra-note" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button className="min-h-12" disabled={busy || !time || (item.kind === "tracker" && value == null)} data-testid="button-extra-save"
            onClick={() => upd.mutate({ id: log.id, value, note, at: stampFor(log.at.slice(0, 10), time) }, { onSuccess: onClose, onError: fail })}>
            Save
          </Button>
          <Button variant="outline" className="min-h-12" disabled={busy} data-testid="button-extra-delete"
            onClick={() => del.mutate(log.id, { onSuccess: onClose, onError: fail })}>
            Delete
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

// ── Diary note ───────────────────────────────────────────────────────────────
export function NoteSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const add = useWrite<{ date: string; at: string; text: string }>("POST", "/api/notes");
  const fail = useFail();
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title="Diary note" description={`${fmtDay(date, { weekday: true })}. Shows in reports alongside that day's scores.`}>
      <div className="space-y-4">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} autoFocus
          placeholder="Sleep, stress, side effects, appointments, anything worth remembering"
          className={cn(fieldCls, "h-auto py-2")} data-testid="input-diary" />
        <Button className="min-h-12 w-full" disabled={add.isPending || !text.trim()} data-testid="button-diary-save"
          onClick={() => add.mutate({ date, at: stampFor(date, defaultTime(date, null)), text }, { onSuccess: onClose, onError: fail })}>
          Save note
        </Button>
      </div>
    </BottomSheet>
  );
}
