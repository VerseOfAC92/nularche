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
  await page.keyboard.press("Meta+/");
  // v1.5: etiketler, matematik sonuçları, yapılacaklar, biçimler; not listesi (galeri) ve odak modu
  const noteId = await page.evaluate(async () => {
    const body = [
      "Planning the spring trip with the team. #travel #plans/2026",
      "",
      "## Budget",
      "",
      "flights = 4 * 189",
      "hotel = 3 * 120",
      "flights + hotel =",
      "",
      "## Checklist",
      "",
      "- [ ] Book the flights",
      "- [ ] Reserve the hotel",
      "- [x] Ask everyone for dates",
      "",
      '<div align="center">',
      "",
      "*“Travel far enough, you meet yourself.”*",
      "",
      "</div>",
      "",
      "+ Passports",
      "+ Chargers",
      "",
      "Water is H<sub>2</sub>O and area grows with r<sup>2</sup>.",
    ].join("\n");
    const n = await (await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Spring trip", parentNodeId: null, body, fields: { icon: "🧳", pinned: true } }) })).json();
    await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Packing ideas", parentNodeId: n.id, body: "Light layers and a rain jacket. #travel" }) });
    await fetch("/api/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ writingBg: { kind: "scene", id: "sunset" } }) });
    return n.id as string;
  });
  await page.evaluate(() => location.reload());
  await page.locator(".sidebar").waitFor();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate((id) => (location.hash = id), noteId);
  await page.waitForTimeout(900);
  // İmleç hesap satırının sonunda: sonuç önerisi görünür.
  const box = (await page.locator(".ProseMirror p", { hasText: "flights + hotel =" }).boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height - 6);
  await page.keyboard.press("Meta+ArrowRight");
  await page.waitForTimeout(300);
  await page.mouse.move(10, 10);
  await shot("notes-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => (location.hash = "notes"));
  await page.waitForTimeout(500);
  await page.locator(".note-list-tools .segmented button").nth(1).click();
  await page.waitForTimeout(400);
  await shot("list-light");
  await page.evaluate((id) => (location.hash = id), noteId);
  await page.waitForTimeout(700);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Meta+Shift+F");
  await page.waitForTimeout(800);
  await page.mouse.move(400, 300);
  await page.waitForTimeout(200);
  await shot("focus-scene");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Obsidian'dan gelen özellikler: özellikler, wiki bağlantıları, matematik, kutu, kenar paneli, grafik, tuval.
  const ids = await page.evaluate(async () => {
    const make = async (title: string, body: string, parentNodeId: string | null, fields?: Record<string, unknown>) =>
      (await (await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, parentNodeId, body, fields }) })).json()) as { id: string; path: string };
    const home = await make("Home", "", null, { icon: "🏡" });
    const solar = await make(
      "Solar panels",
      [
        "# Overview",
        "Comparing panels for the roof, see [[Roof measurements]] and the [[Energy log|monthly log]].",
        "Yearly yield $E = A \\cdot r \\cdot H \\cdot PR$ with a performance ratio of $0.75$.",
        "",
        "> [!tip] Rule of thumb",
        "> South-facing roofs at 30–35° get the most sun[^1].",
        "",
        "```mermaid",
        "graph LR; Panels-->Inverter-->Battery; Inverter-->Grid",
        "```",
        "",
        "[^1]: In the northern hemisphere.",
      ].join("\n"),
      home.id,
    );
    await fetch(`/api/nodes/${solar.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ properties: { aliases: ["PV", "Solar"], status: "researching", budget: 4200, tags: ["home"] } }) });
    await make("Roof measurements", "South side: 8.2 m × 4.5 m. Related: [[Solar panels]] and [[Battery options]].", home.id);
    await make("Battery options", "Compare 10 kWh units for [[PV]]. #home", home.id);
    await make("Energy log", "October: 412 kWh. The Solar panels research should cut this in half.", home.id);
    const heat = await make("Heat pump", "Maybe after the [[Solar panels]] are in.", home.id);
    const fresh = async (id: string) => ((await (await fetch(`/api/nodes/${id}`)).json()) as { path: string }).path;
    const canvas = {
      nodes: [
        { id: "a", type: "text", text: "# Home energy\nGoals for next year", x: 0, y: 0, width: 260, height: 120, color: "5" },
        { id: "b", type: "file", file: await fresh(solar.id), x: 360, y: -80, width: 280, height: 150, color: "4" },
        { id: "c", type: "file", file: await fresh(heat.id), x: 360, y: 120, width: 280, height: 120 },
        { id: "d", type: "text", text: "Budget: **€12k**", x: 0, y: 200, width: 220, height: 70, color: "3" },
      ],
      edges: [
        { id: "e1", fromNode: "a", toNode: "b", toEnd: "arrow" },
        { id: "e2", fromNode: "a", toNode: "c", toEnd: "arrow" },
        { id: "e3", fromNode: "a", toNode: "d", toEnd: "arrow", label: "limit" },
      ],
    };
    const board = await make("Home plan", "```json canvas\n" + JSON.stringify(canvas, null, 2) + "\n```\n", home.id, { layout: "canvas", icon: "🧩" });
    await fetch("/api/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ writingBg: { kind: "none" }, sidePanel: "links" }) });
    return { solar: solar.id, canvas: board.id };
  });
  await page.evaluate(() => location.reload());
  await page.locator(".sidebar").waitFor();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate((id) => (location.hash = id), ids.solar);
  await page.locator(".mermaid-render svg").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.mouse.move(10, 10);
  await shot("obsidian-dark");
  await page.evaluate(() => (location.hash = "graph"));
  await page.waitForTimeout(3500);
  await shot("graph-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.keyboard.press("Meta+Shift+O"); // kenar panelini kapat
  await page.evaluate((id) => (location.hash = id), ids.canvas);
  await page.locator(".canvas-card").first().waitFor();
  await page.waitForTimeout(800);
  await shot("canvas-light");
  console.log(`Ekran görüntüleri: ${out}`);
} finally {
  await app.close();
}
