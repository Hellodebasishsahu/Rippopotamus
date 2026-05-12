import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

const buildId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
});
