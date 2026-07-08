import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

const root = path.dirname(fileURLToPath(import.meta.url));
const buildId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);

export default defineConfig({
  root,
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    outDir: path.join(root, "dist/renderer"),
    emptyOutDir: true,
  },
});
