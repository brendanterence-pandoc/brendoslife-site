import type { Express } from "express";
import type { Server } from "node:http";
import { createApi } from "./core";
import { db } from "./storage";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const api = createApi(db);

  app.use("/api", (req, res) => {
    let out;
    try {
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) if (typeof v === "string") query[k] = v;
      out = api.handle(req.method, `/api${req.path}`, query, req.body ?? {});
    } catch (e: any) {
      console.error("API error:", e);
      out = { status: 400, json: { message: e?.message ?? "Request failed" } };
    }
    res.status(out.status);
    res.setHeader("Cache-Control", "no-store");
    if (out.text != null) {
      res.setHeader("Content-Type", out.contentType ?? "text/plain; charset=utf-8");
      if (out.filename) res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
      res.send(out.text);
    } else res.json(out.json ?? {});
  });

  return httpServer;
}
