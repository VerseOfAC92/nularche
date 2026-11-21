// nularche.verseofac.com için statik site dosyalarını üretir: gizlilik sayfası PRIVACY.md'den, görseller
// docs/screenshots ve build/icon.png'den. Ana sayfa (site/index.html) elle yazılır. Üretilen dosyalar depoya
// işlenir; Cloudflare Pages `site/` klasörünü derleme yapmadan yayınlar. `--check` yalnızca güncel olup
// olmadıklarını denetler (CI).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";
import { projectRoot } from "../packages/core/src/config.ts";
import { sceneUrl } from "../packages/web/src/focus/scenes.ts";

const root = projectRoot();
const site = path.join(root, "site");
const check = process.argv.includes("--check");

/** Ana sayfadaki görseller: yayın adı → kaynak. */
export const SITE_IMAGES: Record<string, string> = {
  "assets/logo.png": "packages/web/public/logo.png",
  "assets/hero.png": "docs/screenshots/atrium-lavender.png",
  "assets/fonts/nularche-font.woff2": "packages/web/src/studio/fonts/nularche-font.woff2",
  "assets/security.png": "docs/screenshots/security-light.png",
  "assets/lectio.png": "docs/screenshots/lectio-light.png",
  "assets/codex.png": "docs/screenshots/codex-light.png",
  "assets/anamnesis.png": "docs/screenshots/anamnesis-light.png",
  "assets/organise.png": "docs/screenshots/archipelago-lavender.png",
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function privacyPage(markdown: string): string {
  const marked = new Marked({ gfm: true });
  const body = String(marked.parse(markdown, { async: false }));
  const updated = /\*Last updated: ([^*]+)\*/.exec(markdown)?.[1] ?? "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy · Nularche</title>
<meta name="description" content="How Nularche handles your data, including Google Drive and Google Calendar. Last updated: ${esc(updated)}.">
<link rel="icon" href="/assets/logo.png">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body class="doc">
<header class="bar"><a class="brand" href="/"><img src="/assets/logo.png" alt="" width="32" height="32"> Nularche</a><nav><a href="/">Home</a><a href="https://github.com/VerseOfAC92/nularche/releases/latest">Download</a></nav></header>
<main class="prose">
${body}
</main>
<footer class="foot"><p>© 2026 VerseOfAC · <a href="/">Nularche</a> · <a href="https://github.com/VerseOfAC92/nularche">Source code</a> · <a href="mailto:verseofac@gmail.com">verseofac@gmail.com</a></p></footer>
</body>
</html>
`;
}

/** Uygulamanın kendi manzaraları (odak modundaki çizimlerle aynı kod): Lavanta tepeleri ve Gece gökyüzü. */
function sceneFile(id: string): string {
  const url = sceneUrl(id);
  if (!url) throw new Error(`Manzara yok: ${id}`);
  return decodeURIComponent(url.replace(/^url\("data:image\/svg\+xml;charset=utf-8,/, "").replace(/"\)$/, ""));
}

const outputs: [string, string | Buffer][] = [
  ["privacy/index.html", privacyPage(await readFile(path.join(root, "PRIVACY.md"), "utf8"))],
  ["assets/scene-lavender.svg", sceneFile("lavender")],
  ["assets/scene-night.svg", sceneFile("night")],
];
for (const [to, from] of Object.entries(SITE_IMAGES)) outputs.push([to, await readFile(path.join(root, from))]);

let stale = 0;
for (const [rel, data] of outputs) {
  const file = path.join(site, rel);
  const current = await readFile(file).catch(() => null);
  const same = current !== null && Buffer.compare(current, Buffer.isBuffer(data) ? data : Buffer.from(data)) === 0;
  if (same) continue;
  stale++;
  if (check) {
    console.error(`Güncel değil: site/${rel}`);
    continue;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}
if (check && stale) {
  console.error("Siteyi güncellemek için: node scripts/build-site.ts");
  process.exit(1);
}
console.log(check ? "Site güncel." : `Site: ${stale} dosya yazıldı.`);
