import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

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
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
});
