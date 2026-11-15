// Portable MedTrack API. No Node or Express imports here on purpose: the same
// handler runs behind Express + better-sqlite3 (sandbox / pplx.app) or inside a
// Cloudflare Durable Object with SQLite storage.
import {
  healthBulkSchema, itemInputSchema, logInputSchema,
  type AppState, type Change, type HealthRow, type Item, type ItemInput, type Log, type Note,
} from "../shared/schema";
import { addDays, describeItem, nameKey } from "../shared/schedule";
import { clinicianReportHtml, dailyCsv, medisafeCsv, parseMedisafeCsv } from "./exports";

export interface SqlDb {
  all(sql: string, params?: unknown[]): any[];
  run(sql: string, params?: unknown[]): { lastId: number; changes: number };
}
export interface ApiResponse {
  status: number;
  json?: unknown;
  text?: string;
  contentType?: string;
  filename?: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT NOT NULL,
    strength TEXT NOT NULL DEFAULT '', dose TEXT NOT NULL DEFAULT '', form TEXT NOT NULL DEFAULT 'pill',
    color TEXT NOT NULL DEFAULT '#E9E6DF', category TEXT NOT NULL DEFAULT '', prn INTEGER NOT NULL DEFAULT 0,
    times TEXT NOT NULL DEFAULT '[]', schedule TEXT NOT NULL DEFAULT '{"type":"daily"}',
    scale_min INTEGER NOT NULL DEFAULT 0, scale_max INTEGER NOT NULL DEFAULT 10,
    low_label TEXT NOT NULL DEFAULT '', high_label TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL, end_date TEXT, sort INTEGER NOT NULL DEFAULT 0, start_time TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, date TEXT NOT NULL, slot TEXT,
    status TEXT NOT NULL, value REAL, at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'app')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS logs_slot ON logs(item_id, date, slot) WHERE slot IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS logs_date ON logs(date)`,
  `CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, at TEXT NOT NULL, text TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, text TEXT NOT NULL, auto INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS health (date TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', PRIMARY KEY (date, metric))`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

const itemRow = (r: any): Item => ({
  id: r.id, kind: r.kind, name: r.name, strength: r.strength, dose: r.dose, form: r.form, color: r.color,
  category: r.category, prn: !!r.prn, times: JSON.parse(r.times), schedule: JSON.parse(r.schedule),
  scaleMin: r.scale_min, scaleMax: r.scale_max, lowLabel: r.low_label, highLabel: r.high_label,
  notes: r.notes, startDate: r.start_date, startTime: r.start_time ?? "", endDate: r.end_date, sort: r.sort,
});
const logRow = (r: any): Log => ({
  id: r.id, itemId: r.item_id, date: r.date, slot: r.slot, status: r.status, value: r.value, at: r.at, note: r.note, source: r.source,
});
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (message: string, status = 400): ApiResponse => ({ status, json: { message } });

export function createApi(db: SqlDb) {
  for (const s of SCHEMA) db.run(s);
  if (!db.all(`PRAGMA table_info(items)`).some((c) => c.name === "start_time")) db.run(`ALTER TABLE items ADD COLUMN start_time TEXT NOT NULL DEFAULT ''`);

  const getItems = (): Item[] => db.all(`SELECT * FROM items ORDER BY sort, name, start_date`).map(itemRow);
  const getItem = (id: number): Item | undefined => db.all(`SELECT * FROM items WHERE id = ?`, [id]).map(itemRow)[0];
  const getLogs = (from = "0000-00-00", to = "9999-99-99"): Log[] =>
    db.all(`SELECT * FROM logs WHERE date >= ? AND date <= ? ORDER BY date, at, id`, [from, to]).map(logRow);
  const getNotes = (): Note[] => db.all(`SELECT * FROM notes ORDER BY at DESC, id DESC`);
  const getChanges = (): Change[] => db.all(`SELECT * FROM changes ORDER BY date DESC, id DESC`).map((r) => ({ ...r, auto: !!r.auto }));
  const getHealth = (from = "0000-00-00", to = "9999-99-99"): HealthRow[] =>
    db.all(`SELECT * FROM health WHERE date >= ? AND date <= ? ORDER BY date, metric`, [from, to]);
  const getMeta = (): Record<string, string> => Object.fromEntries(db.all(`SELECT key, value FROM meta`).map((r) => [r.key, r.value]));
  const setMeta = (k: string, v: string) =>
    db.run(`INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]);
  const addChange = (date: string, text: string, auto = true) =>
    db.run(`INSERT INTO changes(date, text, auto) VALUES(?, ?, ?)`, [date, text, auto ? 1 : 0]);

  function insertItem(i: ItemInput, startDate: string, startTime = ""): Item {
    const times = [...new Set(i.times)].sort();
    const sort = i.sort ?? (db.all(`SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM items`)[0].s as number);
    const r = db.run(
      `INSERT INTO items(kind, name, strength, dose, form, color, category, prn, times, schedule, scale_min, scale_max, low_label, high_label, notes, start_date, end_date, sort, start_time)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [i.kind, i.name, i.strength, i.dose, i.form, i.color, i.category, i.prn ? 1 : 0, JSON.stringify(i.prn ? [] : times),
        JSON.stringify(i.schedule), i.scaleMin, i.scaleMax, i.lowLabel, i.highLabel, i.notes, startDate, i.endDate ?? null, sort, startTime],
    );
    return getItem(r.lastId)!;
  }
  function updateItemInPlace(id: number, i: ItemInput) {
    const times = [...new Set(i.times)].sort();
    db.run(
      `UPDATE items SET name=?, strength=?, dose=?, form=?, color=?, category=?, prn=?, times=?, schedule=?, scale_min=?, scale_max=?, low_label=?, high_label=?, notes=? WHERE id=?`,
      [i.name, i.strength, i.dose, i.form, i.color, i.category, i.prn ? 1 : 0, JSON.stringify(i.prn ? [] : times),
        JSON.stringify(i.schedule), i.scaleMin, i.scaleMax, i.lowLabel, i.highLabel, i.notes, id],
    );
  }
  const label = (i: { kind: string; name: string }) => (i.kind === "tracker" ? `${i.name} tracking` : i.name);
  const scheduleKey = (i: Pick<Item, "strength" | "dose" | "prn" | "times" | "schedule">) =>
    JSON.stringify([i.strength, i.dose, !!i.prn, i.prn ? [] : [...new Set(i.times)].sort(), i.schedule]);

  function upsertLog(l: ReturnType<typeof logInputSchema.parse>): Log {
    if (l.slot) {
      db.run(
        `INSERT INTO logs(item_id, date, slot, status, value, at, note, source) VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(item_id, date, slot) WHERE slot IS NOT NULL
         DO UPDATE SET status=excluded.status, value=excluded.value, at=excluded.at, note=excluded.note, source=excluded.source`,
        [l.itemId, l.date, l.slot, l.status, l.value, l.at, l.note, l.source],
      );
      return db.all(`SELECT * FROM logs WHERE item_id=? AND date=? AND slot=?`, [l.itemId, l.date, l.slot]).map(logRow)[0];
    }
    const r = db.run(`INSERT INTO logs(item_id, date, slot, status, value, at, note, source) VALUES(?,?,?,?,?,?,?,?)`,
      [l.itemId, l.date, null, l.status, l.value, l.at, l.note, l.source]);
    return db.all(`SELECT * FROM logs WHERE id=?`, [r.lastId]).map(logRow)[0];
  }

  function reportInputs(q: Record<string, string>) {
    const now = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(q.now ?? "") ? q.now : new Date().toISOString().slice(0, 16);
    const to = DATE.test(q.to ?? "") ? q.to : now.slice(0, 10);
    const from = DATE.test(q.from ?? "") ? q.from : addDays(to, -29);
    return { items: getItems(), logs: getLogs(from, to), health: getHealth(from, to), notes: getNotes(), changes: getChanges(), from, to, now };
  }

  function handle(method: string, path: string, query: Record<string, string>, body: any): ApiResponse {
    const seg = path.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const [a, b, c] = seg;
    const id = Number(b);
    const today: string = DATE.test(body?.today ?? "") ? body.today : new Date().toISOString().slice(0, 10);
    // Time of day an item was added, when the client says it is being added on its own start date.
    const addedAt = (start: string): string =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body?.now ?? "") && body.now.slice(0, 10) === start ? body.now.slice(11, 16) : "";

    if (a === "state" && method === "GET") {
      const first = db.all(`SELECT MIN(d) AS d FROM (SELECT MIN(date) AS d FROM logs UNION ALL SELECT MIN(date) AS d FROM health)`)[0]?.d ?? null;
      const healthSummary = db.all(`SELECT metric, COUNT(*) AS days, MIN(date) AS first, MAX(date) AS last FROM health GROUP BY metric ORDER BY metric`);
      const state: AppState = { items: getItems(), notes: getNotes(), changes: getChanges(), meta: getMeta(), firstDate: first, healthSummary };
      return { status: 200, json: state };
    }

    // ── Items (medications + trackers) ──────────────────────────────────────
    if (a === "items") {
      if (method === "POST" && !b) {
        const p = itemInputSchema.safeParse(body);
        if (!p.success) return bad(p.error.issues.map((i) => i.message).join("; "));
        const start = p.data.startDate ?? today;
        const item = insertItem(p.data, start, addedAt(start));
        if (!body.silent) addChange(item.startDate, `Started ${label(item)}: ${describeItem(item)}`);
        return { status: 201, json: item };
      }
      const cur = getItem(id);
      if (!cur) return bad("Item not found", 404);
      if (method === "PATCH" && !c) {
        const p = itemInputSchema.safeParse({ ...cur, ...body, kind: cur.kind });
        if (!p.success) return bad(p.error.issues.map((i) => i.message).join("; "));
        const next = p.data;
        const scheduleChanged = scheduleKey(cur) !== scheduleKey(next as any);
        if (scheduleChanged && body.mode !== "correct" && cur.startDate < today) {
          // Version the item so history keeps the old schedule.
          db.run(`UPDATE items SET end_date = ? WHERE id = ?`, [addDays(today, -1), id]);
          const item = insertItem({ ...next, endDate: null, sort: cur.sort }, today);
          db.run(`UPDATE logs SET item_id = ? WHERE item_id = ? AND date >= ?`, [item.id, id, today]);
          addChange(today, `Changed ${label(cur)}: ${describeItem(cur)} → ${describeItem(item)}`);
          return { status: 200, json: item };
        }
        updateItemInPlace(id, next);
        if (scheduleChanged && body.mode !== "correct") addChange(today, `Changed ${label(cur)}: ${describeItem(cur)} → ${describeItem(getItem(id)!)}`);
        if (typeof body.sort === "number") db.run(`UPDATE items SET sort = ? WHERE id = ?`, [body.sort, id]);
        return { status: 200, json: getItem(id) };
      }
      if (method === "POST" && c === "stop") {
        const end = body.effective === "tomorrow" ? today : addDays(today, -1);
        // An end date before the start date means the item never became active
        // (stopped on the day it was added). Its logged entries stay in history.
        db.run(`UPDATE items SET end_date = ? WHERE id = ?`, [end, id]);
        addChange(body.effective === "tomorrow" ? addDays(today, 1) : today, `Stopped ${label(cur)}${cur.strength ? ` ${cur.strength}` : ""}${body.reason ? ` (${String(body.reason).slice(0, 200)})` : ""}`);
        return { status: 200, json: getItem(id) };
      }
      if (method === "POST" && c === "restart") {
        const item = insertItem({ ...cur, endDate: null, sort: cur.sort }, today, addedAt(today));
        addChange(today, `Restarted ${label(item)}: ${describeItem(item)}`);
        return { status: 201, json: item };
      }
      if (method === "DELETE") {
        const n = db.all(`SELECT COUNT(*) AS n FROM logs WHERE item_id = ?`, [id])[0].n;
        if (n > 0 && query.force !== "1") return bad("This item has history. Stop it instead so reports stay intact.", 409);
        db.run(`DELETE FROM logs WHERE item_id = ?`, [id]);
        db.run(`DELETE FROM items WHERE id = ?`, [id]);
        return { status: 200, json: { ok: true } };
      }
    }

    // ── Logs (doses + ratings) ──────────────────────────────────────────────
    if (a === "logs") {
      if (method === "GET") return { status: 200, json: getLogs(query.from, query.to) };
      if (method === "POST" && b === "batch") {
        const out: Log[] = [];
        for (const raw of body?.logs ?? []) {
          const p = logInputSchema.safeParse(raw);
          if (!p.success) return bad("Invalid log entry");
          out.push(upsertLog(p.data));
        }
        return { status: 200, json: out };
      }
      if (method === "POST") {
        const p = logInputSchema.safeParse(body);
        if (!p.success) return bad(p.error.issues.map((i) => i.message).join("; "));
        if (!getItem(p.data.itemId)) return bad("Item not found", 404);
        return { status: 201, json: upsertLog(p.data) };
      }
      if (method === "PATCH" && id) {
        const cur = db.all(`SELECT * FROM logs WHERE id = ?`, [id]).map(logRow)[0];
        if (!cur) return bad("Log not found", 404);
        const p = logInputSchema.safeParse({ ...cur, ...body, itemId: cur.itemId, slot: cur.slot });
        if (!p.success) return bad(p.error.issues.map((i) => i.message).join("; "));
        db.run(`UPDATE logs SET date=?, status=?, value=?, at=?, note=? WHERE id=?`,
          [p.data.date, p.data.status, p.data.value, p.data.at, p.data.note, id]);
        return { status: 200, json: db.all(`SELECT * FROM logs WHERE id = ?`, [id]).map(logRow)[0] };
      }
      if (method === "DELETE" && id) {
        db.run(`DELETE FROM logs WHERE id = ?`, [id]);
        return { status: 200, json: { ok: true } };
      }
    }

    // ── Diary notes + regimen change log ────────────────────────────────────
    if (a === "notes") {
      if (method === "POST") {
        const text = String(body?.text ?? "").trim().slice(0, 2000);
        if (!text || !DATE.test(body?.date ?? "")) return bad("Note text and date are required");
        const r = db.run(`INSERT INTO notes(date, at, text) VALUES(?,?,?)`, [body.date, body.at ?? `${body.date}T12:00`, text]);
        return { status: 201, json: db.all(`SELECT * FROM notes WHERE id = ?`, [r.lastId])[0] };
      }
      if (method === "DELETE" && id) {
        db.run(`DELETE FROM notes WHERE id = ?`, [id]);
        return { status: 200, json: { ok: true } };
      }
    }
    if (a === "changes") {
      if (method === "POST") {
        const text = String(body?.text ?? "").trim().slice(0, 500);
        if (!text || !DATE.test(body?.date ?? "")) return bad("Change text and date are required");
        addChange(body.date, text, false);
        return { status: 201, json: { ok: true } };
      }
      if (method === "DELETE" && id) {
        db.run(`DELETE FROM changes WHERE id = ?`, [id]);
        return { status: 200, json: { ok: true } };
      }
    }

    // ── Apple Health daily metrics ──────────────────────────────────────────
    if (a === "health") {
      if (method === "GET") return { status: 200, json: getHealth(query.from, query.to) };
      if (method === "POST" && b === "bulk") {
        const p = healthBulkSchema.safeParse(body);
        if (!p.success) return bad("Invalid health rows");
        for (const r of p.data.rows)
          db.run(
            `INSERT INTO health(date, metric, value, unit, source) VALUES(?,?,?,?,?)
             ON CONFLICT(date, metric) DO UPDATE SET value=excluded.value, unit=excluded.unit, source=excluded.source`,
            [r.date, r.metric, r.value, r.unit, p.data.source],
          );
        setMeta("health_synced_at", String(body?.syncedAt ?? new Date().toISOString()));
        return { status: 200, json: { ok: true, rows: p.data.rows.length } };
      }
    }
    if (a === "meta" && method === "PUT" && b) {
      setMeta(b, String(body?.value ?? ""));
      return { status: 200, json: getMeta() };
    }

    // ── Exports ─────────────────────────────────────────────────────────────
    if (a === "export" && method === "GET") {
      const inp = reportInputs(query);
      const tag = `${inp.from}_to_${inp.to}`;
      if (b === "medisafe.csv") return { status: 200, text: medisafeCsv(inp), contentType: "text/csv; charset=utf-8", filename: `medtrack_history_${tag}.csv` };
      if (b === "daily.csv") return { status: 200, text: dailyCsv(inp), contentType: "text/csv; charset=utf-8", filename: `medtrack_daily_${tag}.csv` };
      if (b === "report.html")
        return { status: 200, text: clinicianReportHtml(inp, getMeta()), contentType: "text/html; charset=utf-8", filename: query.inline === "1" ? undefined : `medication_mood_report_${tag}.html` };
      if (b === "backup.json") {
        const backup = { app: "medtrack", version: 1, exportedAt: new Date().toISOString(), items: getItems(), logs: getLogs(), notes: getNotes(), changes: getChanges(), health: getHealth(), meta: getMeta() };
        return { status: 200, text: JSON.stringify(backup), contentType: "application/json", filename: query.inline === "1" ? undefined : `medtrack_backup_${today}.json` };
      }
    }

    // ── Imports ─────────────────────────────────────────────────────────────
    if (a === "import" && method === "POST") {
      if (b === "medisafe") {
        const rows = parseMedisafeCsv(String(body?.csv ?? ""));
        if (!rows.length) return bad("No Medisafe rows found. Expected columns: Type, Name, Recorded on, Scheduled for, Value, Notes.");
        const items = getItems();
        let added = 0, updated = 0, created = 0;
        const spans = new Map<string, { min: string; max: string }>();
        for (const r of rows) {
          const k = `${r.kind}|${nameKey(r.name)}`;
          const s = spans.get(k);
          if (!s) spans.set(k, { min: r.date, max: r.date });
          else { if (r.date < s.min) s.min = r.date; if (r.date > s.max) s.max = r.date; }
        }
        for (const r of rows) {
          const k = `${r.kind}|${nameKey(r.name)}`;
          const same = items.filter((i) => i.kind === r.kind && nameKey(i.name) === nameKey(r.name));
          let item = same.find((i) => i.startDate <= r.date && (!i.endDate || r.date <= i.endDate)) ?? same.sort((x, y) => y.startDate.localeCompare(x.startDate))[0];
          if (!item) {
            const s = spans.get(k)!;
            item = insertItem(itemInputSchema.parse({
              kind: r.kind, name: r.name, prn: false, times: [], notes: "Imported from Medisafe history",
              color: r.kind === "tracker" ? "#20808D" : "#E9E6DF", endDate: s.max,
            }), s.min);
            items.push(item);
            created++;
          }
          // As-needed medications have no schedule, so their doses are stored as unscheduled.
          const slot = item.prn && !item.times.length ? null : r.slot;
          if (slot) {
            const ex = db.all(`SELECT id FROM logs WHERE item_id=? AND date=? AND slot=?`, [item.id, r.date, slot])[0];
            if (ex && body?.overwrite === false) continue;
            upsertLog({ itemId: item.id, date: r.date, slot, status: r.status, value: r.value, at: r.at, note: r.note, source: "medisafe" });
            ex ? updated++ : added++;
          } else {
            const ex = db.all(`SELECT id FROM logs WHERE item_id=? AND at=? AND slot IS NULL`, [item.id, r.at])[0];
            if (ex) continue;
            upsertLog({ itemId: item.id, date: r.date, slot: null, status: r.status, value: r.value, at: r.at, note: r.note, source: "medisafe" });
            added++;
          }
        }
        return { status: 200, json: { rows: rows.length, added, updated, itemsCreated: created } };
      }
      if (b === "backup") {
        const bk = body?.backup;
        if (!bk || bk.app !== "medtrack" || !Array.isArray(bk.items)) return bad("Not a MedTrack backup file");
        const n = db.all(`SELECT (SELECT COUNT(*) FROM items) + (SELECT COUNT(*) FROM logs) AS n`)[0].n;
        if (n > 0 && body.replace !== true) return bad("This tracker already has data. Confirm replace to overwrite it.", 409);
        for (const t of ["items", "logs", "notes", "changes", "health", "meta"]) db.run(`DELETE FROM ${t}`);
        for (const i of bk.items as Item[])
          db.run(`INSERT INTO items(id, kind, name, strength, dose, form, color, category, prn, times, schedule, scale_min, scale_max, low_label, high_label, notes, start_date, end_date, sort, start_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [i.id, i.kind, i.name, i.strength, i.dose, i.form, i.color, i.category, i.prn ? 1 : 0, JSON.stringify(i.times), JSON.stringify(i.schedule), i.scaleMin, i.scaleMax, i.lowLabel, i.highLabel, i.notes, i.startDate, i.endDate, i.sort, i.startTime ?? ""]);
        for (const l of (bk.logs ?? []) as Log[])
          db.run(`INSERT INTO logs(id, item_id, date, slot, status, value, at, note, source) VALUES(?,?,?,?,?,?,?,?,?)`, [l.id, l.itemId, l.date, l.slot, l.status, l.value, l.at, l.note, l.source]);
        for (const x of (bk.notes ?? []) as Note[]) db.run(`INSERT INTO notes(id, date, at, text) VALUES(?,?,?,?)`, [x.id, x.date, x.at, x.text]);
        for (const x of (bk.changes ?? []) as Change[]) db.run(`INSERT INTO changes(id, date, text, auto) VALUES(?,?,?,?)`, [x.id, x.date, x.text, x.auto ? 1 : 0]);
        for (const h of (bk.health ?? []) as HealthRow[]) db.run(`INSERT INTO health(date, metric, value, unit, source) VALUES(?,?,?,?,?)`, [h.date, h.metric, h.value, h.unit, h.source]);
        for (const [k, v] of Object.entries(bk.meta ?? {})) setMeta(k, String(v));
        return { status: 200, json: { ok: true, items: bk.items.length, logs: (bk.logs ?? []).length } };
      }
    }

    return bad("Not found", 404);
  }

  return { handle };
}
