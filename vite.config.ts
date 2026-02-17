import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const wranglerPort = process.env.WRANGLER_PORT || "8787";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  server: {
    proxy: {
      "/api": `http://localhost:${wranglerPort}`,
      "/auth": `http://localhost:${wranglerPort}`,
      "/ws": {
        target: `ws://localhost:${wranglerPort}`,
        ws: true,
      },
    },
  },
});
