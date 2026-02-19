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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom/") || id.includes("node_modules/react/")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/konva/") || id.includes("node_modules/react-konva/")) {
            return "vendor-canvas";
          }
          if (
            id.includes("node_modules/ai/") ||
            id.includes("node_modules/agents/") ||
            id.includes("node_modules/@cloudflare/ai-chat/") ||
            id.includes("node_modules/@ai-sdk/")
          ) {
            return "vendor-ai";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  server: {
    watch: {
      // Exclude build outputs from chokidar to reduce FD usage in multi-worktree setups
      ignored: ["**/dist/**", "**/.wrangler/**", "**/.playwright-cli/**"],
    },
    proxy: {
      "/api": `http://localhost:${wranglerPort}`,
      "/auth": `http://localhost:${wranglerPort}`,
      "/ws": {
        target: `ws://localhost:${wranglerPort}`,
        ws: true,
      },
      "/agents": {
        target: `ws://localhost:${wranglerPort}`,
        ws: true,
      },
    },
  },
});
