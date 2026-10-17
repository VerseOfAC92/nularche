// README ekran görüntülerini üretir: uygulama kaynaktan, sahte bir kullanıcı klasörü ve örnek (İngilizce) içerikle açılır.
// Kullanım: node scripts/screenshots.ts [--out docs/screenshots]

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { projectRoot } from "../packages/core/src/config.ts";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const root = projectRoot();
const out = path.resolve(arg("--out") ?? path.join(root, "docs", "screenshots"));
const work = await mkdtemp(path.join(tmpdir(), "nularche-shots-"));
const userData = path.join(work, "ud");
const origin = path.join(work, "Nularche");
await mkdir(path.join(userData, "config"), { recursive: true });
await mkdir(origin, { recursive: true });
await mkdir(out, { recursive: true });
await writeFile(path.join(userData, "config", "settings.json"), JSON.stringify({ originDir: origin, onboarded: true, language: "en" }));

const app = await electron.launch({
  executablePath: path.join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
  args: [root, "--lang=en"],
  env: { ...process.env, HOME: path.join(work, "home"), NULARCHE_USER_DATA: userData, NULARCHE_E2E: "1" },
});
const page: Page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
const fromTemplate = async (name: string) => {
  await page.locator(".side-btn", { hasText: "Templates" }).click();
  await page.locator(".segmented button", { hasText: "New Arche" }).click();
  await page.locator(".tpl-card", { hasText: name }).first().click();
  await page.waitForTimeout(1500);
};

try {
  await page.locator(".sidebar").waitFor({ timeout: 20_000 });
  await page.emulateMedia({ colorScheme: "dark" });
  await fromTemplate("Reading list");
  await fromTemplate("Task board");
  await fromTemplate("Project");
  // Proje sayfası: özet + gömülü görev panosu (koyu tema)
  await page.mouse.move(10, 10);
  await shot("project-dark");
  // Tam sayfa görev panosu: takvim ve tablo
  await page.locator(".tree-row", { hasText: "Task board" }).click();
  await page.waitForTimeout(800);
  await page.locator(".db-tab", { hasText: "Board" }).click();
  await page.waitForTimeout(400);
  await shot("board-dark");
  await page.locator(".db-tab", { hasText: "Calendar" }).click();
  await page.waitForTimeout(400);
  await shot("calendar-dark");
  // Okuma listesi galerisi (açık tema)
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".tree-row", { hasText: "Reading list" }).click();
  await page.waitForTimeout(800);
  await shot("gallery-light");
  await page.locator(".db-tab", { hasText: "Table" }).click();
  await page.waitForTimeout(400);
  await shot("table-light");
  // Şablon galerisi
  await page.locator(".side-btn", { hasText: "Templates" }).click();
  await page.waitForTimeout(400);
  await shot("templates-light");
  await page.keyboard.press("Escape");
  await page.locator(".dialog .icon-btn").first().click();
  // Nularche AI penceresi ve kısayollar (koyu)
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator(".tree-row", { hasText: "Project" }).click();
  await page.waitForTimeout(600);
  await page.locator(".claude-btn").click();
  await page.waitForTimeout(600);
  await shot("ai-dark");
  await page.locator(".nai-panel .icon-btn").last().click();
  await page.keyboard.press("Meta+/");
  await page.waitForTimeout(400);
  await shot("shortcuts-dark");
  console.log(`Ekran görüntüleri: ${out}`);
} finally {
  await app.close();
}
