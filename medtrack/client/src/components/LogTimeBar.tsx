// Top-of-screen control for the time new entries are stamped with.
import { Clock } from "lucide-react";
import { fmtTime } from "@shared/schedule";
import { nowStamp } from "@/lib/api";
import { useLogTime, type LogTimeMode } from "@/lib/logTime";
import { cn } from "@/lib/utils";

const OPTIONS: { mode: LogTimeMode; label: string }[] = [
  { mode: "now", label: "Now" },
  { mode: "scheduled", label: "On schedule" },
  { mode: "custom", label: "Set time" },
];

export function LogTimeBar({ date, today }: { date: string; today: string }) {
  const lt = useLogTime();
  const on = lt.mode !== "now";
  const later = lt.mode === "custom" && date === today && lt.time > nowStamp().slice(11, 16);
  const summary =
    lt.mode === "scheduled"
      ? "Doses and check-ins are recorded at their scheduled times."
      : lt.mode === "custom"
        ? lt.time ? `Everything you log is recorded at ${fmtTime(lt.time)}.` : "Pick the time to record."
        : date === today
          ? "Entries are recorded at the moment you tap."
          : "Entries for past days are recorded at their scheduled times.";
  return (
    <div
      className={cn("mb-4 rounded-lg border px-3 py-2.5", on ? "border-gold bg-gold/10" : "bg-card")}
      role="group"
      aria-label="Logging time"
      data-testid="bar-log-time"
    >
      <div className="space-y-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Clock className={cn("h-4 w-4", on ? "text-gold-ink" : "text-muted-foreground")} aria-hidden="true" />
          Logging time
        </span>
        <div className="grid grid-cols-3 rounded-md border bg-background p-0.5" role="radiogroup" aria-label="Record entries at">
          {OPTIONS.map((o) => {
            const sel = lt.mode === o.mode;
            return (
              <button
                key={o.mode}
                type="button"
                role="radio"
                aria-checked={sel}
                onClick={() => lt.set(o.mode)}
                data-testid={`log-time-${o.mode}`}
                className={cn(
                  "min-h-10 rounded px-3 text-sm font-medium",
                  sel ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      {lt.mode === "custom" && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Record at</span>
          <input
            type="time"
            value={lt.time}
            onChange={(e) => e.target.value && lt.set("custom", e.target.value)}
            className="h-11 rounded-md border border-input bg-background px-3 text-base tabular-nums"
            data-testid="input-log-time"
          />
        </label>
      )}
      <p className={cn("mt-1.5 text-xs", later ? "text-warn" : "text-muted-foreground")} data-testid="text-log-time-summary">
        {later ? `${fmtTime(lt.time)} is later than now. Check the time before logging. ` : ""}
        {summary}
        {on && lt.minutesLeft != null && ` Switches back to Now in ${lt.minutesLeft} min.`}
      </p>
    </div>
  );
}
