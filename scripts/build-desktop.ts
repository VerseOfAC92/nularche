// Masaüstü uygulamasının Node tarafını (ana süreç, preload, MCP sunucusu) esbuild ile paketler.
// Electron'un gömülü Node'u TypeScript'i doğrudan çalıştıramadığı için gereklidir.
import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../packages/core/src/config.ts";

const root = projectRoot();
const out = path.join(root, "dist-desktop");

// Yerleşik Google istemcisi (Google Takvim ve Drive için tek tıkla giriş): ortam değişkenlerinden (yayın derlemesi,
// GitHub sırları) ya da depoya girmeyen google-client.json dosyasından (Google Cloud'dan indirilen JSON). Hiçbiri
// yoksa uygulama kullanıcının kendi istemcisini girmesini ister.
function googleClient(): { clientId: string; clientSecret: string } | null {
  const id = process.env.NULARCHE_GOOGLE_CLIENT_ID;
  const secret = process.env.NULARCHE_GOOGLE_CLIENT_SECRET;
  if (id && secret) return { clientId: id, clientSecret: secret };
  const file = path.join(root, "google-client.json");
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const c = raw.installed ?? raw;
  return c.client_id && c.client_secret ? { clientId: c.client_id, clientSecret: c.client_secret } : null;
}
const client = googleClient();
console.log(client ? "Google istemcisi: yerleşik" : "Google istemcisi: yok (kullanıcı kendi istemcisini girer)");
const common = {
  bundle: true,
  platform: "node" as const,
  target: "node22",
  sourcemap: false,
  logLevel: "warning" as const,
  legalComments: "none" as const,
};

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(root, "packages/desktop/src/main.ts")],
    outfile: path.join(out, "main.cjs"),
    format: "cjs",
    external: ["electron"],
    define: { __NULARCHE_GOOGLE_CLIENT__: JSON.stringify(client) },
  }),
  build({
    ...common,
    entryPoints: [path.join(root, "packages/desktop/src/preload.ts")],
    outfile: path.join(out, "preload.cjs"),
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: [path.join(root, "packages/mcp/src/index.ts")],
    outfile: path.join(out, "mcp.mjs"),
    format: "esm",
    // ESM paketinde CommonJS bağımlılıklarının require çağrıları için.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  }),
]);
console.log(`Paketlendi: ${out}`);
