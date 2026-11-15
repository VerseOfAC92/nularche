import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  // Tabula resimli şekilleri: paketin "exports" alanı JSON verisini dışa açmadığı için doğrudan klasöre takma ad.
  resolve: { alias: { "tabler-icons-data": fileURLToPath(new URL("../../node_modules/@tabler/icons", import.meta.url)) } },
  // cssTarget: masaüstü Chromium'dur; varsayılan hedefte küçültücü `backdrop-filter`ı yalnızca `-webkit-` önekiyle
  // bırakıyor ve Chromium buzlu cam efektini hiç çizmiyordu.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000, cssTarget: ["chrome120", "safari16", "firefox115", "edge120"] },
  // Geliştirme modunda (npm run dev:web) API isteklerini yerel sunucuya yönlendir.
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:5178" } },
});
