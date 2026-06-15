import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite directly emits to ../server/web/dist so go:embed picks it up at
// `go build` time. The prebuild script removes generated assets while
// preserving dist/.gitkeep for fresh checkout embeds.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
  },
  build: {
    outDir: "../server/web/dist",
    emptyOutDir: false,
  },
  server: {
    fs: {
      allow: [".."],
    },
    port: 5173,
    proxy: {
      // During `pnpm dev`, forward API calls to the locally-running
      // taskline-server so we can develop against real data without CORS
      // gymnastics in the browser.
      "/api": "http://127.0.0.1:8787",
      "/healthz": "http://127.0.0.1:8787",
    },
  },
});
