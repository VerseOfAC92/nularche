// @vitest-environment jsdom
// Crypta tam şifreleme uçtan uca: arayüzün Crypta katmanı (crypta.ts) gerçek NodeStore'a bağlanır. Şifrelenen
// Arche'nin diskteki dosyalarında başlık, özellik, sayfa alanı ve ağaç yapısı kalmamalı; Arche açılınca hepsi geri
// gelmeli; eski (yalnızca içeriği şifreli) Arche yükseltilmeli; şifre kaldırılınca düzen geri kurulmalı.

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeStore, SHADOW } from "../../core/src/node-store.ts";
import type { NodeDoc, NodeMeta, PageFields, ParentTarget } from "../src/api.ts";
import { cryptaApi, reveal, sealArche, unsealArche, type RawApi } from "../src/crypta.ts";
import { closeAllLocked, createArcheLock, sealForArche, unlockArche, unlockNote, type ArcheLock } from "../src/lock.ts";

let root: string;
let store: NodeStore;
let raw: RawApi;
let api: ReturnType<typeof cryptaApi> & { list: () => Promise<NodeMeta[]> };

const asParent = (p: ParentTarget) => (p === "shadow" ? SHADOW : p);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nularche-crypta-"));
  store = new NodeStore(root);
  await store.ensureRoot();
  raw = {
    list: () => store.list() as Promise<NodeMeta[]>,
    read: (id) => store.read(id) as Promise<NodeDoc>,
    create: (title, parentNodeId, body, fields) => store.create({ title, parentNodeId: asParent(parentNodeId), body, fields: fields as never }) as Promise<NodeDoc>,
    update: (id, patch) => store.update(id, patch as never) as Promise<NodeDoc>,
    move: (id, parentNodeId) => store.move(id, asParent(parentNodeId)) as Promise<NodeDoc>,
    reorder: async (parentNodeId, ids) => ({ nodes: (await store.reorder(asParent(parentNodeId), ids)) as NodeMeta[] }),
    duplicate: (id, input) => store.duplicate(id, input as never) as Promise<NodeDoc>,
    trash: (id) => store.trash(id),
    sealLayout: async (id) => ({ moved: await store.sealLayout(id) }),
  };
  api = cryptaApi(raw) as typeof api;
});

afterEach(async () => {
  closeAllLocked();
  await rm(root, { recursive: true, force: true });
});

/** Origin'deki bütün not dosyaları ve içerikleri (gizli klasörler hariç). */
async function disk(): Promise<{ files: string[]; text: string }> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.name.endsWith(".md")) files.push(path.relative(root, abs));
    }
  };
  await walk(root);
  let text = files.join("\n");
  for (const f of files) text += `\n${await readFile(path.join(root, f), "utf8")}`;
  // Gizli klasörlerdeki not geçmişi de taranır: başlıklar orada da kalmamalı.
  const hidden = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await hidden(abs);
      else if (e.name.endsWith(".md")) text += `\n${await readFile(abs, "utf8")}`;
    }
  };
  await hidden(path.join(root, ".nularche"));
  return { files, text };
}

/** Düz bir Arche: kök, alt not, torun, veritabanı satırı benzeri özellikli not. */
async function plainArche() {
  const arche = await raw.create("Gizli Proje", null, "kök metni");
  const child = await raw.create("Toplantı Notları", arche.id, "toplantı içeriği", { icon: "📅" } as PageFields);
  const grand = await raw.create("Bütçe Ayrıntıları", child.id, "rakamlar");
  await raw.update(grand.id, { properties: { durum: "taslak", aliases: ["Para Planı"] } });
  return { arche, child, grand };
}

const SECRETS = ["Gizli Proje", "Toplantı Notları", "Bütçe Ayrıntıları", "toplantı içeriği", "rakamlar", "taslak", "Para Planı", "📅", "Gizli-Proje", "Toplanti"];

async function encrypt(archeId: string, password = "çok-gizli"): Promise<ArcheLock> {
  const lock = await createArcheLock(archeId, password, "ipucu");
  await raw.update(archeId, { fields: { archeLock: lock } });
  await sealArche(raw, archeId);
  return lock;
}

describe("Crypta tam şifreleme", () => {
  it("diskte başlık, özellik, alan ve ağaç kalmaz; Arche açılınca hepsi geri gelir", async () => {
    const { arche, child, grand } = await plainArche();
    const lock = await encrypt(arche.id);

    const { files, text } = await disk();
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
    // Bütün notlar Arche klasöründe düz ve rastgele adlı: klasör derinliği ağacı ele vermez.
    expect(files).toHaveLength(3);
    const dir = path.dirname(files.find((f) => path.basename(f, ".md") === path.basename(path.dirname(f)))!);
    for (const f of files) expect(f.startsWith(`${dir}${path.sep}`) && f.split(path.sep).length === 2).toBe(true);
    for (const f of files) expect(path.basename(f, ".md")).toMatch(/^c[0-9a-z]{12}$/);
    expect(text).toContain("ipucu"); // parola ipucu kilidi açabilmek için açık kalır

    // Açıkken: gerçek başlıklar, alanlar, özellikler ve ağaç.
    const open = await api.list();
    const byTitle = (t: string) => open.find((n) => n.title === t)!;
    expect(byTitle("Gizli Proje").id).toBe(arche.id);
    expect(byTitle("Toplantı Notları").parentNodeId).toBe(arche.id);
    expect(byTitle("Toplantı Notları").icon).toBe("📅");
    expect(byTitle("Bütçe Ayrıntıları").parentNodeId).toBe(child.id);
    expect(byTitle("Bütçe Ayrıntıları").aliases).toEqual(["Para Planı"]);
    const doc = await api.read(grand.id);
    expect(doc.properties).toEqual({ durum: "taslak", aliases: ["Para Planı"] });

    // Kapalıyken: yalnızca Arche yer tutucuyla görünür; notları listede yok, sunucu araması başlık bulmaz.
    closeAllLocked();
    const closed = await api.list();
    expect(closed.map((n) => n.id)).toEqual([arche.id]);
    expect(closed[0].title).not.toBe("Gizli Proje");
    expect(await store.search("Toplantı")).toEqual([]);
    expect(await store.search("Crypta")).toEqual([]);

    // Parolayla açınca geri gelir.
    expect(await unlockArche(arche.id, lock, "çok-gizli")).toBe(true);
    expect((await api.list()).map((n) => n.title).sort()).toEqual(["Bütçe Ayrıntıları", "Gizli Proje", "Toplantı Notları"]);
  }, 60_000);

  it("açık Arche'de yazma, oluşturma, taşıma, sıralama, çoğaltma ve çöp zarfla çalışır", async () => {
    const { arche, child, grand } = await plainArche();
    await encrypt(arche.id);

    await api.update(child.id, { title: "Yeniden Adlandırılmış", fields: { icon: "🗂️" }, properties: { sahip: "Ayşe" } });
    const created = await api.create("Yeni Alt Not", child.id, "yeni içerik", { icon: "🌱" });
    expect(created.title).toBe("Yeni Alt Not");
    expect(created.parentNodeId).toBe(child.id);

    // Arche içinde taşıma yalnızca zarfı değiştirir; döngü reddedilir.
    await api.move(grand.id, arche.id);
    await expect(api.move(child.id, created.id)).rejects.toThrow();
    await api.reorder(arche.id, [grand.id, child.id]);

    const copy = await api.duplicate(child.id, { title: "Kopya" });
    expect(copy.title).toBe("Kopya");

    const list = await api.list();
    const get = (id: string) => list.find((n) => n.id === id)!;
    expect(get(child.id).title).toBe("Yeniden Adlandırılmış");
    expect(get(child.id).icon).toBe("🗂️");
    expect(get(grand.id).parentNodeId).toBe(arche.id);
    expect(get(grand.id).order).toBe(0);
    expect(get(child.id).order).toBe(1);
    expect(list.filter((n) => n.parentNodeId === copy.id).map((n) => n.title)).toEqual(["Yeni Alt Not"]);
    expect((await api.read(child.id)).properties).toEqual({ sahip: "Ayşe" });

    const { files, text } = await disk();
    for (const secret of ["Yeniden Adlandırılmış", "Yeni Alt Not", "yeni içerik", "Ayşe", "Kopya", "🌱", "🗂️"]) expect(text, secret).not.toContain(secret);
    expect(new Set(files.map((f) => f.split(path.sep).length))).toEqual(new Set([2]));

    // Çöp: alt notlar zarftaki ağaçla birlikte gider.
    await api.trash(child.id);
    expect((await api.list()).some((n) => n.id === created.id)).toBe(false);
  }, 60_000);

  it("Arche'ye dışarıdan taşınan not mühürlenir; kapalı Arche'ye yazılamaz", async () => {
    const { arche } = await plainArche();
    const lock = await encrypt(arche.id);
    const outside = await raw.create("Dışarıdaki Not", null, "dış içerik");
    const sub = await raw.create("Dış Alt", outside.id, "alt içerik");
    await api.move(outside.id, arche.id);
    const list = await api.list();
    expect(list.find((n) => n.id === outside.id)!.parentNodeId).toBe(arche.id);
    expect(list.find((n) => n.id === sub.id)!.parentNodeId).toBe(outside.id);
    const { text } = await disk();
    for (const secret of ["Dışarıdaki Not", "Dış Alt", "dış içerik", "alt içerik"]) expect(text, secret).not.toContain(secret);

    // Sunucu da garanti eder: zarfı açamayan bir araç (ör. MCP) mühürlü nota açık başlık ya da özellik yazsa bile
    // diske yalnızca zarf, kimlik, zaman ve kilit alanları yazılır.
    await raw.update(sub.id, { title: "Açık Başlık", properties: { gizli: "Açık Değer" }, fields: { icon: "🚨" } });
    const leak = await disk();
    for (const secret of ["Açık Başlık", "Açık Değer", "🚨"]) expect(leak.text, secret).not.toContain(secret);
    expect((await api.read(sub.id)).title).toBe("Dış Alt");

    closeAllLocked();
    // Kapalıyken daha önce çözülmüş başlıklar özetlerde de görünmez.
    const summary = await reveal({ results: [{ id: sub.id, title: "Crypta" }] });
    expect(summary.results[0].title).not.toBe("Dış Alt");
    await expect(api.create("Sızan", arche.id, "x")).rejects.toThrow();
    await expect(api.update(sub.id, { title: "Sızan" })).rejects.toThrow();
    expect(await unlockArche(arche.id, lock, "çok-gizli")).toBe(true);
  }, 60_000);

  it("eski şifreli Arche (yalnızca içerik) yükseltilir; şifre kaldırılınca düzen ve başlıklar geri gelir", async () => {
    const { arche, child, grand } = await plainArche();
    // Eski sürüm: yalnızca gövdeler şifreli, archeLock.v yok.
    const lock = await createArcheLock(arche.id, "eski-parola");
    const { v: _v, ...v1 } = lock;
    await raw.update(arche.id, { fields: { archeLock: v1 } });
    for (const n of await raw.list()) {
      const d = await raw.read(n.id);
      await raw.update(n.id, { body: (await sealForArche(arche.id, d.body, "🔒"))!, fields: { locked: true } });
    }
    expect((await disk()).text).toContain("Toplantı Notları");

    // Yükseltme (arayüzde Arche açılınca watchCrypta yapar).
    closeAllLocked();
    const rootDoc = await raw.read(arche.id);
    expect(await unlockNote(arche.id, "eski-parola", rootDoc.body)).not.toBeNull();
    await raw.update(arche.id, { fields: { archeLock: { ...v1, v: 2 } } });
    await sealArche(raw, arche.id);
    const upgraded = await disk();
    for (const secret of SECRETS) expect(upgraded.text, secret).not.toContain(secret);
    expect((await api.read(grand.id)).title).toBe("Bütçe Ayrıntıları");

    // Şifreyi kaldır: başlıklar, alanlar, özellikler, gövdeler ve klasör ağacı geri gelir.
    const r = await unsealArche(raw, arche.id);
    expect(r.skipped).toBe(0);
    const plain = await raw.list();
    const get = (id: string) => plain.find((n) => n.id === id)!;
    expect(get(arche.id).title).toBe("Gizli Proje");
    expect(get(arche.id).archeLock).toBeUndefined();
    expect(get(child.id).parentNodeId).toBe(arche.id);
    expect(get(grand.id).parentNodeId).toBe(child.id);
    expect(get(child.id).icon).toBe("📅");
    expect(get(grand.id).path).toMatch(/Gizli Proje\/Toplant.*\/B.*\.md$/u);
    expect((await raw.read(grand.id)).body.trim()).toBe("rakamlar");
    expect((await raw.read(grand.id)).properties).toEqual({ durum: "taslak", aliases: ["Para Planı"] });
    expect(plain.some((n) => n.sealed)).toBe(false);
    void lock;
  }, 60_000);

  it("arama ve grafik gibi özetlerde başlık zarftan gelir; bilinmeyen nesnelere dokunulmaz", async () => {
    const { arche, child } = await plainArche();
    await encrypt(arche.id);
    await api.list();
    const summary = await reveal({ results: [{ id: child.id, title: "Crypta", path: "x" }], other: { id: "başka", title: "aynen" } });
    expect(summary.results[0].title).toBe("Toplantı Notları");
    expect(summary.other.title).toBe("aynen");
  }, 60_000);
});
