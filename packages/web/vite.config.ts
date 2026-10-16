import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  // Geliştirme modunda (npm run dev:web) API isteklerini yerel sunucuya yönlendir.
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:5178" } },
});
