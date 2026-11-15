// MedTrack data model. Plain TypeScript types + zod validators.
// Storage is raw SQLite via a tiny portable interface (see server/core.ts),
// so the same API runs on Node (better-sqlite3) or a Cloudflare Durable Object.
import { z } from "zod";

export const scheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({ type: z.literal("weekdays"), days: z.array(z.number().int().min(0).max(6)).min(1) }),
  z.object({
    type: z.literal("interval"),
    every: z.number().int().min(2).max(365),
    anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^\d{2}:\d{2}$/);

export const itemInputSchema = z.object({
  kind: z.enum(["med", "tracker"]),
  name: z.string().trim().min(1).max(80),
  strength: z.string().trim().max(40).default(""),
  dose: z.string().trim().max(40).default(""),
  form: z.string().trim().max(20).default("pill"),
  color: z.string().trim().max(20).default("#E9E6DF"),
  category: z.string().trim().max(40).default(""),
  prn: z.boolean().default(false),
  times: z.array(timeStr).max(12).default([]),
  schedule: scheduleSchema.default({ type: "daily" }),
  scaleMin: z.number().int().default(0),
  scaleMax: z.number().int().default(10),
  lowLabel: z.string().trim().max(30).default(""),
  highLabel: z.string().trim().max(30).default(""),
  notes: z.string().trim().max(500).default(""),
  startDate: dateStr.optional(),
  endDate: dateStr.nullable().optional(),
  sort: z.number().int().optional(),
});
export type ItemInput = z.infer<typeof itemInputSchema>;

export interface Item extends Required<Omit<ItemInput, "endDate" | "startDate" | "sort">> {
  id: number;
  startDate: string;
  /** "HH:MM" when the item was added partway through its first day. Earlier slots that day are not expected. */
  startTime: string;
  endDate: string | null;
  sort: number;
}

export const logInputSchema = z.object({
  itemId: z.number().int(),
  date: dateStr,
  slot: timeStr.nullable().default(null),
  status: z.enum(["taken", "skipped", "recorded", "missed"]),
  value: z.number().nullable().default(null),
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  note: z.string().max(1000).default(""),
  source: z.string().max(20).default("app"),
});
export type LogInput = z.infer<typeof logInputSchema>;
export interface Log extends LogInput {
  id: number;
}

export interface Note {
  id: number;
  date: string;
  at: string;
  text: string;
}
export interface Change {
  id: number;
  date: string;
  text: string;
  auto: boolean;
}
export interface HealthRow {
  date: string;
  metric: string;
  value: number;
  unit: string;
  source: string;
}
export interface AppState {
  items: Item[];
  notes: Note[];
  changes: Change[];
  meta: Record<string, string>;
  /** Earliest date with any log or health row (for the "All" report range). */
  firstDate: string | null;
  healthSummary: { metric: string; days: number; first: string; last: string }[];
}

export const healthBulkSchema = z.object({
  source: z.string().max(40).default("apple_health"),
  rows: z
    .array(
      z.object({
        date: dateStr,
        metric: z.string().min(1).max(40),
        value: z.number(),
        unit: z.string().max(20).default(""),
      }),
    )
    .max(20000),
});
