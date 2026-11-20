// Güvenlik: yerel API oturum anahtarı ve içerik güvenlik politikası; yayınlanan sitede ham HTML ve bağlantı temizliği.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exportPageHtml, NodeStore, safeUrl, sanitizeRawHtml } from "../src/index.ts";
import { APP_CSP, SESSION_COOKIE, startServer } from "../../server/src/app.ts";

test("ham HTML: yalnızca Nularche'nin güvenli etiketleri geçer, gerisi metin olarak kaçırılır", () => {
  assert.equal(sanitizeRawHtml('<span style="color: #f85149">kırmızı</span>'), '<span style="color: #f85149">kırmızı</span>');
  assert.equal(sanitizeRawHtml('<div align="center" dir="rtl">'), '<div align="center" dir="rtl">');
  assert.equal(sanitizeRawHtml("<details open><summary>Başlık</summary>"), "<details open><summary>Başlık</summary>");
  assert.equal(sanitizeRawHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(sanitizeRawHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(sanitizeRawHtml('<span onclick="x()" style="background:url(javascript:alert(1))">a</span>'), "<span>a</span>");
  assert.equal(sanitizeRawHtml('<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>'), "&lt;svg&gt;&lt;animate attributeName=&quot;href&quot; to=&quot;javascript:alert(1)&quot;/&gt;&lt;/svg&gt;");
  assert.equal(sanitizeRawHtml("<!-- gizli --><sup>2</sup>"), "<sup>2</sup>");
  assert.equal(sanitizeRawHtml("a < b"), "a &lt; b");
});

test("bağlantı adresleri: gizlenmiş javascript: ve diğer tehlikeli şemalar düşer", () => {
  for (const ok of ["https://example.com", "mailto:a@b.c", "tel:+90", "#bolum", "../Not.html", "resim.png"]) assert.equal(safeUrl(ok), ok);
  for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "java&#09;script:alert(1)", "&#106;avascript:alert(1)", "vbscript:x", "data:text/html,<script>"]) {
    assert.equal(safeUrl(bad), "", bad);
  }
  assert.equal(safeUrl("data:image/png;base64,AAA", { image: true }), "data:image/png;base64,AAA");
  assert.equal(safeUrl("data:image/png;base64,AAA"), "", "data: yalnızca görsellerde");
});

test("yayınlanan sayfa: nottaki betik, olay öznitelikleri ve javascript: bağlantıları çalışmaz; Nularche biçimleri korunur", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-sec-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  const note = await store.create({
    title: "Saldırı",
    body: [
      "<script>alert('xss')</script>",
      "",
      '<img src="x" onerror="alert(1)">',
      "",
      "[tıkla](javascript:alert(1)) ve [sekmeli](java&#09;script:alert(1)) ve [site](https://example.com)",
      "",
      '<span style="color: #3fb950">yeşil</span> x<sup>2</sup>',
      "",
      "> [!WARNING] Dikkat",
      "> metin",
    ].join("\n"),
  });
  const { html } = await exportPageHtml(store, note.id, "tr");
  const main = html.slice(html.indexOf("<main"));
  assert.ok(!/<script>alert/i.test(main), "betik etiketi kaçırılmalı");
  assert.ok(!/<img[^>]*onerror/i.test(main), "olay özniteliği geçmemeli");
  assert.ok(!/href="\s*java/i.test(main), "javascript: bağlantısı geçmemeli");
  assert.ok(main.includes('<a href="https://example.com">site</a>'));
  assert.ok(main.includes('<span style="color: #3fb950">yeşil</span>'), "renk korunur");
  assert.ok(main.includes("<sup>2</sup>"));
  assert.ok(/callout callout-warning/.test(main), "uyarı kutusu korunur");
});

test("yerel API: oturum anahtarı olmadan erişilemez; arayüz sıkı içerik güvenlik politikasıyla gelir", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-sec-"));
  const web = path.join(root, "web");
  await mkdir(web);
  await writeFile(path.join(web, "index.html"), "<!doctype html><title>x</title>");
  const server = await startServer({ originDir: path.join(root, "origin"), webDist: web, port: 0, token: "gizli-anahtar" });
  try {
    assert.equal((await fetch(`${server.url}/api/nodes`)).status, 401, "anahtarsız istek reddedilir");
    assert.equal((await fetch(`${server.url}/api/nodes`, { headers: { "x-nularche-token": "wrong" } })).status, 401);
    assert.equal((await fetch(`${server.url}/files/a.png`)).status, 401, "ekler de korunur");
    assert.equal((await fetch(`${server.url}/api/nodes`, { headers: { "x-nularche-token": "gizli-anahtar" } })).status, 200);
    const page = await fetch(`${server.url}/`, { headers: { cookie: `${SESSION_COOKIE}=gizli-anahtar` } });
    assert.equal(page.status, 200, "çerezle arayüz açılır");
    assert.equal(page.headers.get("content-security-policy"), APP_CSP);
    assert.match(APP_CSP, /script-src 'self'(;|$)/, "satır içi betik yok");
    assert.match(APP_CSP, /object-src 'none'/);
    assert.equal((await fetch(`${server.url}/api/nodes`, { headers: { "x-nularche-token": "gizli-anahtar", origin: "https://evil.example" } })).status, 403, "başka siteden gelen istek reddedilir");
  } finally {
    await server.close();
  }
});
