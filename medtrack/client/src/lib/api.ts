import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AppState, HealthRow, Log, LogInput } from "@shared/schema";
import { toDateStr, toStamp } from "@shared/schedule";
import { API_BASE, apiRequest, queryClient } from "./queryClient";

export { API_BASE };

/** Local wall-clock "YYYY-MM-DDTHH:MM", refreshed every 30 seconds. */
export function useNow(): string {
  const [now, setNow] = useState(() => toStamp(new Date()));
  useEffect(() => {
    const tick = () => setNow(toStamp(new Date()));
    const id = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return now;
}
export const todayStr = () => toDateStr(new Date());
export const nowStamp = () => toStamp(new Date());

const get = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();

export function useAppState() {
  return useQuery<AppState>({ queryKey: ["state"], queryFn: () => get("/api/state") });
}
export function useLogs(from: string, to: string, enabled = true) {
  return useQuery<Log[]>({
    queryKey: ["logs", from, to],
    queryFn: () => get(`/api/logs?from=${from}&to=${to}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}
export function useHealth(from: string, to: string, enabled = true) {
  return useQuery<HealthRow[]>({
    queryKey: ["health", from, to],
    queryFn: () => get(`/api/health?from=${from}&to=${to}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export const refreshAll = () => queryClient.invalidateQueries();

function patchLogCaches(fn: (logs: Log[], from: string, to: string) => Log[]) {
  for (const [key, data] of queryClient.getQueriesData<Log[]>({ queryKey: ["logs"] })) {
    if (!data) continue;
    queryClient.setQueryData(key, fn(data, key[1] as string, key[2] as string));
  }
}
const mergeLog = (l: Log) =>
  patchLogCaches((logs, from, to) => {
    const rest = logs.filter((x) => x.id !== l.id && !(l.slot && x.itemId === l.itemId && x.date === l.date && x.slot === l.slot));
    return l.date >= from && l.date <= to ? [...rest, l] : rest;
  });

export type NewLog = Omit<LogInput, "source" | "note" | "value" | "slot"> & Partial<Pick<LogInput, "note" | "value" | "slot">>;

export function useSaveLogs() {
  return useMutation({
    mutationFn: async (logs: NewLog[]): Promise<Log[]> => (await apiRequest("POST", "/api/logs/batch", { logs })).json(),
    onSuccess: (saved) => {
      saved.forEach(mergeLog);
      queryClient.invalidateQueries({ queryKey: ["logs"] });
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });
}
export function useUpdateLog() {
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: number } & Partial<LogInput>): Promise<Log> => (await apiRequest("PATCH", `/api/logs/${id}`, patch)).json(),
    onSuccess: (l) => {
      mergeLog(l);
      queryClient.invalidateQueries({ queryKey: ["logs"] });
    },
  });
}
export function useDeleteLog() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/logs/${id}`);
      return id;
    },
    onSuccess: (id) => {
      patchLogCaches((logs) => logs.filter((l) => l.id !== id));
      queryClient.invalidateQueries({ queryKey: ["logs"] });
    },
  });
}
/** Generic write that refreshes everything afterwards (regimen edits, notes, imports). */
export function useWrite<TBody = unknown, TOut = any>(method: string, url: string | ((b: TBody) => string)) {
  return useMutation({
    mutationFn: async (body: TBody): Promise<TOut> => {
      const res = await apiRequest(method, typeof url === "function" ? url(body) : url, method === "DELETE" ? undefined : body);
      return res.json();
    },
    onSuccess: () => refreshAll(),
  });
}

export const exportUrl = (file: string, params: Record<string, string>) =>
  `${API_BASE}/api/export/${file}?${new URLSearchParams(params).toString()}`;
