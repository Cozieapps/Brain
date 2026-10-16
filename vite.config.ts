import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { isolationHeaders, offlinePwa } from "./scripts/offline-pwa";
export default defineConfig({
  plugins: [react(), offlinePwa()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers", "kokoro-js"] },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        main: resolve("index.html"),
        offline: resolve("offline.html"),
      },
      output: {
        manualChunks: {
          temporal: ["@js-temporal/polyfill"],
          validation: ["zod"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    headers: isolationHeaders,
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
  preview: { headers: isolationHeaders },
});
