// README görsellerini tek bir görünümde çerçeveler: sitenin (site/assets/site.css) sıcak kâğıt zemini, logonun iki
// yarısından gelen yumuşak serin ve bronz ışık, cam pencere ve derin gölge. Ham ekran görüntüleri (2x) bir klasörden
// okunur, çerçevelenmiş hâlleri docs/screenshots'a yazılır. Sitenin kendisi görselleri kendi penceresiyle çerçevelediği
// için sitede kullanılan görsellerin çerçevesiz (1x) kopyaları docs/screenshots/site'a yazılır (scripts/build-site.ts).
// Kullanım: node scripts/frame-screenshots.ts <ham-klasör> [<ham-klasör>…]

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { projectRoot } from "../packages/core/src/config.ts";

const root = projectRoot();
const out = path.join(root, "docs", "screenshots");
const siteOut = path.join(out, "site");
/** Sitede çerçevesiz kullanılanlar (scripts/build-site.ts SITE_IMAGES). */
const SITE = new Set(["atrium-lavender", "security-light", "lectio-light", "codex-light", "anamnesis-light", "archipelago-lavender"]);
const dirs = process.argv.slice(2);
if (!dirs.length) throw new Error("usage: node scripts/frame-screenshots.ts <raw-dir> [...]");
await mkdir(siteOut, { recursive: true });

/** Ekran görüntüsünün CSS boyutu (ham görüntü 2x). */
const W = 1440;
const H = 900;
const PAD = 64;
/** Çıktı çözünürlüğü: README'de 860 piksel genişlikte, yüksek yoğunluklu ekranda net görünsün. */
const SCALE = 1.25;

const page = (png: string) => `<!doctype html><html><head><style>
  html, body { margin: 0; }
  body { width: ${W + PAD * 2}px; height: ${H + PAD * 2}px; position: relative; overflow: hidden;
    background: radial-gradient(120% 90% at 85% 10%, #fbf6ec 0%, #f6efe3 45%, #eadfcb 100%); }
  .cool { position: absolute; inset: 0; background: radial-gradient(70% 70% at 8% 95%, rgba(111, 147, 184, 0.42) 0%, rgba(111, 147, 184, 0) 70%); }
  .warm { position: absolute; inset: 0; background: radial-gradient(60% 60% at 96% 4%, rgba(168, 117, 58, 0.22) 0%, rgba(168, 117, 58, 0) 70%); }
  .window { position: absolute; left: ${PAD - 9}px; top: ${PAD - 9}px; padding: 8px; border-radius: 22px;
    background: rgba(255, 252, 246, 0.62); border: 1px solid rgba(255, 255, 255, 0.85);
    box-shadow: 0 46px 90px rgba(20, 34, 54, 0.30), 0 12px 28px rgba(20, 34, 54, 0.14), 0 2px 0 rgba(255, 255, 255, 0.7) inset; }
  .window img { display: block; width: ${W}px; height: ${H}px; border-radius: 14px; box-shadow: 0 0 0 1px rgba(20, 34, 54, 0.10); }
</style></head><body><div class="cool"></div><div class="warm"></div>
<div class="window"><img src="data:image/png;base64,${png}"></div></body></html>`;

const browser = await chromium.launch({ headless: true, ...(process.env.NULARCHE_CHROME ? { executablePath: process.env.NULARCHE_CHROME } : { channel: "chrome" }) });
try {
  const framed = await browser.newPage({ viewport: { width: W + PAD * 2, height: H + PAD * 2 }, deviceScaleFactor: SCALE });
  const plain = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  let n = 0;
  for (const dir of dirs) {
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".png")).sort()) {
      const name = file.slice(0, -4);
      const png = (await readFile(path.join(dir, file))).toString("base64");
      await framed.setContent(page(png));
      await framed.locator("img").evaluate((img: HTMLImageElement) => img.decode());
      await writeFile(path.join(out, file), await framed.screenshot({ type: "png" }));
      if (SITE.has(name)) {
        await plain.setContent(`<body style="margin:0"><img style="display:block;width:${W}px;height:${H}px" src="data:image/png;base64,${png}"></body>`);
        await plain.locator("img").evaluate((img: HTMLImageElement) => img.decode());
        await writeFile(path.join(siteOut, file), await plain.screenshot({ type: "png" }));
      }
      n++;
    }
  }
  console.log(`Framed ${n} screenshots into ${path.relative(root, out)}`);
} finally {
  await browser.close();
}
