// Web oturumu (session.ts): Drive'daki şifreli Origin'i parola ile açar, belleğe indirir, değişiklikleri geri
// gönderir ve kapatınca belleği siler. Bu test yalnızca web platform katmanıyla çalışır (npm run test:web-platform):
// çekirdeğin dosya işlemleri bellek içi dosya sistemine gider. Drive, Google'ın küçük bir taklididir.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { GoogleDrive } from "../../core/src/drive-google.ts";
import { decryptFile, deriveKeys, keyCheck, newSalt, syncOrigin } from "../../core/src/drive-sync.ts";
import { NodeStore } from "../../core/src/node-store.ts";
import { startFakeDrive, type FakeDrive } from "../../core/test/fake-drive.ts";
import { findOrigin, OpenError, openOrigin, originDir, unlockKeys } from "../src/session.ts";
import { vfs } from "../src/vfs.ts";

let fake: FakeDrive;
let tokens = 0;
const drive = () =>
  new GoogleDrive(
    {
      accessToken: async () => {
        tokens++;
        return "web-token";
      },
    },
    { api: `${fake.url}/drive/v3`, upload: `${fake.url}/upload/drive/v3` },
  );
const PASS = "uzun bir parola cümlesi";

before(async () => {
  fake = await startFakeDrive();
  // Masaüstü uygulaması gibi: şifreli bir kök oluşturup bir not yükle.
  const d = drive();
  const salt = newSalt();
  const keys = await deriveKeys(PASS, salt);
  const rootId = await d.createRoot("Nularche", { salt, check: keyCheck(keys) });
  const desk = new NodeStore("/desk");
  await desk.ensureRoot();
  await desk.create({ title: "Plan", parentNodeId: null, body: "masaüstünden #plan" });
  await syncOrigin("/desk", d, rootId, { host: "Masaüstü", keys });
  vfs.clear();
});
after(() => fake.close());

const until = async (ok: () => boolean | Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error("beklenen durum oluşmadı");
    await new Promise((r) => setTimeout(r, 20));
  }
};

test("web oturumu: parola doğrulanır, notlar belleğe iner, değişiklik şifreli gönderilir, kapatınca bellek silinir", async () => {
  const d = drive();
  const root = await findOrigin(d);
  assert.equal(root.encrypted, true);
  await assert.rejects(unlockKeys(root, null), (e: unknown) => e instanceof OpenError && e.code === "passphrase_required");
  await assert.rejects(unlockKeys(root, "yanlış"), (e: unknown) => e instanceof OpenError && e.code === "wrong_passphrase");
  const keys = await unlockKeys(root, PASS);
  assert.ok(keys);

  const statuses: string[] = [];
  const origin = await openOrigin(d, root, keys, { pushDelay: 20, pullEvery: 0, onStatus: (s) => statuses.push(s.state) });
  const notes = await origin.store.list();
  const plan = notes.find((n) => n.title === "Plan");
  assert.ok(plan, "masaüstündeki not web'de görünür");
  assert.match((await origin.store.read(plan.id)).body, /masaüstünden/);
  assert.ok(tokens > 0, "Drive istekleri tarayıcının verdiği belirteci kullanır");

  // Web'de yeni not: kısa bir beklemeyle şifreli olarak Drive'a gider (adı ve içeriği okunamaz).
  await origin.store.create({ title: "Webden", parentNodeId: null, body: "tarayıcıda yazıldı" });
  const findWeb = () => [...fake.files.values()].find((f) => !f.trashed && f.name.endsWith(".nlce") && decryptFile(keys!, new Uint8Array(f.data)).rel.endsWith("Webden.md"));
  await until(() => !!findWeb());
  const uploaded = findWeb()!;
  assert.ok(!uploaded.name.includes("Webden") && !uploaded.data.toString("latin1").includes("tarayıcıda"), "Drive'da ad ve içerik şifreli");
  assert.ok(statuses.includes("syncing") && statuses.at(-1) === "idle");

  await origin.close();
  assert.equal(origin.store.root, originDir(root), "Origin, Drive'daki klasörün adını taşır");
  assert.equal(vfs.files().size, 0, "kapatınca bellekte not kalmaz");
});

test("web oturumu: Drive'da yapılan değişiklik eşitlemeyle gelir (şifresiz kök)", async () => {
  const d = drive();
  const rootId = await d.createRoot("Açık");
  // Şifresiz kökü en yeni yapmak için ona bir not yükle.
  const desk = new NodeStore("/desk2");
  await desk.ensureRoot();
  await desk.create({ title: "Günlük", parentNodeId: null, body: "ilk" });
  await syncOrigin("/desk2", d, rootId, { host: "Masaüstü" });
  vfs.clear();

  const root = (await d.findRoots()).find((r) => r.id === rootId)!;
  assert.equal(await unlockKeys(root, null), null, "açık kökte parola gerekmez");
  const origin = await openOrigin(d, root, null, { pushDelay: 20, pullEvery: 0 });
  // Dosya adı ASCII'ye çevrilir (Günlük → Gunluk.md); başlık notun içinde kalır.
  const file = [...fake.files.values()].find((f) => !f.trashed && f.name === "Gunluk.md");
  assert.ok(file);
  fake.edit(file.id, file.data.toString("utf8").replace("ilk", "başka cihazdan"));
  await origin.sync();
  const note = (await origin.store.list()).find((n) => n.title === "Günlük")!;
  assert.match((await origin.store.read(note.id)).body, /başka cihazdan/);
  await origin.close();
});
