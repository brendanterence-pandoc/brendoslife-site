import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// MEDTRACK_TARGET=site builds the hosted copy: served from /meds/ with its API
// at /meds/api, written straight into the site's public folder.
const site = process.env.MEDTRACK_TARGET === "site";
if (site) process.env.VITE_API_BASE = "/meds";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: site ? "/meds/" : "./",
  build: {
    outDir: site ? path.resolve(import.meta.dirname, "..", "public", "meds") : path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
