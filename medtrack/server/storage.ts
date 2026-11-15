// Node adapter for the portable SQL interface used by server/core.ts.
import Database from "better-sqlite3";
import type { SqlDb } from "./core";

const sqlite = new Database(process.env.MEDTRACK_DB || "data.db");
sqlite.pragma("journal_mode = WAL");

export const db: SqlDb = {
  all(sql, params = []) {
    return sqlite.prepare(sql).all(...(params as any[]));
  },
  run(sql, params = []) {
    const r = sqlite.prepare(sql).run(...(params as any[]));
    return { lastId: Number(r.lastInsertRowid), changes: r.changes };
  },
};
