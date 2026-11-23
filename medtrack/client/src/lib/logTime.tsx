// Shared "logging time" setting. Lets entries be stamped with the time something
// was actually taken or felt, not the moment it was tapped in the app.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { nowStamp } from "./api";

export type LogTimeMode = "now" | "scheduled" | "custom";
interface Saved { mode: LogTimeMode; time: string; setAt: number }

/** A non-default setting reverts to "now" after this long, so it is never left on by accident. */
export const LOG_TIME_TTL_MIN = 30;
const KEY = "medtrack.logTime";
const fresh = (s: Saved | null) => !!s && s.mode !== "now" && Date.now() - s.setAt < LOG_TIME_TTL_MIN * 60000;

function load(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    return fresh(s) ? s : null;
  } catch {
    return null;
  }
}

interface Ctx {
  mode: LogTimeMode;
  /** "HH:MM" used in custom mode. */
  time: string;
  /** Minutes left before the setting reverts to now (null in now mode). */
  minutesLeft: number | null;
  set: (mode: LogTimeMode, time?: string) => void;
  /** Default "HH:MM" for an entry on `date`, at scheduled `slot` (null when unscheduled). */
  timeFor: (date: string, slot: string | null) => string;
  /** Full "YYYY-MM-DDTHH:MM" stamp for an entry. */
  stampFor: (date: string, slot: string | null) => string;
}

const LogTimeContext = createContext<Ctx | null>(null);

export function LogTimeProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Saved | null>(load);
  const [tick, setTick] = useState(0);

  // Re-check the expiry every 30 seconds and whenever the app comes back to the foreground.
  useEffect(() => {
    const t = () => setTick((n) => n + 1);
    const id = setInterval(t, 30000);
    document.addEventListener("visibilitychange", t);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", t);
    };
  }, []);
  useEffect(() => {
    if (saved && !fresh(saved)) {
      setSaved(null);
      localStorage.removeItem(KEY);
    }
  }, [saved, tick]);

  const set = useCallback((mode: LogTimeMode, time?: string) => {
    if (mode === "now") {
      setSaved(null);
      localStorage.removeItem(KEY);
      return;
    }
    const next: Saved = { mode, time: time ?? saved?.time ?? nowStamp().slice(11, 16), setAt: Date.now() };
    setSaved(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  }, [saved]);

  const value = useMemo<Ctx>(() => {
    const active = fresh(saved) ? saved! : null;
    const mode = active?.mode ?? "now";
    const time = active?.time ?? "";
    const timeFor = (date: string, slot: string | null) => {
      const now = nowStamp();
      const isToday = date === now.slice(0, 10);
      if (mode === "custom" && time) return time;
      if (mode === "scheduled" && slot) return slot;
      return isToday ? now.slice(11, 16) : slot ?? "12:00";
    };
    return {
      mode, time, set, timeFor,
      stampFor: (date, slot) => `${date}T${timeFor(date, slot)}`,
      minutesLeft: active ? Math.max(1, Math.ceil(LOG_TIME_TTL_MIN - (Date.now() - active.setAt) / 60000)) : null,
    };
    // tick keeps minutesLeft current
  }, [saved, set, tick]);

  return <LogTimeContext.Provider value={value}>{children}</LogTimeContext.Provider>;
}

export function useLogTime(): Ctx {
  const c = useContext(LogTimeContext);
  if (!c) throw new Error("useLogTime outside LogTimeProvider");
  return c;
}
