// Web platform katmanı ile Node aynı baytları üretmeli: Drive'daki şifreli dosyalar, not kilitleri ve özetler
// masaüstünde ve tarayıcıda aynı olmalı.

import assert from "node:assert/strict";
import * as node from "node:crypto";
import { test } from "node:test";
import { Buffer as WebBuffer } from "../src/buffer.ts";
import * as web from "../src/crypto.ts";
import { Vfs } from "../src/vfs.ts";

const samples = ["", "a", "Nularche · şifreli not 🗝️", "x".repeat(100_000)];

test("özetler ve HMAC Node ile aynı", () => {
  for (const s of samples) {
    for (const alg of ["sha256", "sha512", "md5"]) assert.equal(web.createHash(alg).update(s).digest("hex"), node.createHash(alg).update(s).digest("hex"), alg);
    const key = node.randomBytes(32);
    assert.equal(web.createHmac("sha256", key).update(s).digest("hex"), node.createHmac("sha256", key).update(s).digest("hex"));
  }
  assert.ok(Buffer.from(web.createHash("sha256").update(new Uint8Array([1, 2, 3])).digest()).equals(node.createHash("sha256").update(new Uint8Array([1, 2, 3])).digest()));
});

test("AES-256-GCM: Node'un şifrelediğini web açar, web'in şifrelediğini Node açar", () => {
  for (const s of samples) {
    const key = node.randomBytes(32);
    const iv = node.randomBytes(12);
    const data = Buffer.from(s);
    const nc = node.createCipheriv("aes-256-gcm", key, iv);
    const nCt = Buffer.concat([nc.update(data), nc.final()]);
    const nTag = nc.getAuthTag();
    const wc = web.createCipheriv("aes-256-gcm", key, iv);
    const wCt = Buffer.concat([wc.update(data), wc.final()]);
    assert.ok(wCt.equals(nCt), "aynı şifreli metin");
    assert.ok(Buffer.from(wc.getAuthTag()).equals(nTag), "aynı doğrulama etiketi");
    const wd = web.createDecipheriv("aes-256-gcm", key, iv).setAuthTag(nTag);
    assert.ok(Buffer.concat([wd.update(nCt), wd.final()]).equals(data));
    const nd = node.createDecipheriv("aes-256-gcm", key, iv);
    nd.setAuthTag(Buffer.from(wc.getAuthTag()));
    assert.ok(Buffer.concat([nd.update(wCt), nd.final()]).equals(data));
  }
  const key = node.randomBytes(32);
  const iv = node.randomBytes(12);
  const c = web.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update("gizli"), c.final()]);
  const tag = Buffer.from(c.getAuthTag());
  tag[0] ^= 1;
  const d = web.createDecipheriv("aes-256-gcm", key, iv).setAuthTag(tag);
  d.update(ct);
  assert.throws(() => d.final(), /authenticate/, "değiştirilmiş etiket reddedilir");
});

test("PBKDF2 Node ile aynı anahtarı türetir", async () => {
  const salt = node.randomBytes(16);
  const want = node.pbkdf2Sync("parola şifre", salt, 10_000, 64, "sha256");
  const got = await new Promise<Buffer>((res, rej) => web.pbkdf2("parola şifre", salt, 10_000, 64, "sha256", (e, k) => (e ? rej(e) : res(Buffer.from(k)))));
  assert.ok(got.equals(want));
});

test("Buffer base64url Node ile aynı", () => {
  for (const s of samples) {
    const b = Buffer.from(s);
    assert.equal(WebBuffer.from(s).toString("base64url"), b.toString("base64url"));
    assert.ok(Buffer.from(WebBuffer.from(b.toString("base64url"), "base64url")).equals(b));
  }
});

test("bellek içi dosya sistemi: Node'daki hata kodları ve yeniden adlandırma", () => {
  const v = new Vfs();
  assert.throws(() => v.readFile("/yok"), { code: "ENOENT" });
  assert.throws(() => v.writeFile("/a/b.txt", "x"), { code: "ENOENT" });
  v.mkdir("/a/b", { recursive: true });
  v.writeFile("/a/b/c.md", "metin");
  assert.throws(() => v.mkdir("/a"), { code: "EEXIST" });
  assert.throws(() => v.rm("/a"), { code: "ERR_FS_EISDIR" });
  assert.throws(() => v.writeFile("/a/b/c.md", "x", { flag: "wx" }), { code: "EEXIST" });
  const seen: string[] = [];
  v.onChange((c) => seen.push(`${c.type}:${c.path}`));
  v.rename("/a/b", "/a/d");
  assert.equal(new TextDecoder().decode(v.readFile("/a/d/c.md")), "metin");
  assert.deepEqual(seen, ["remove:/a/b/c.md", "write:/a/d/c.md"]);
  assert.deepEqual(v.readdir("/a"), ["d"]);
  v.rm("/a", { recursive: true });
  assert.equal(v.get("/a/d/c.md"), undefined);
  assert.throws(() => v.rename("/x", "/y"), { code: "ENOENT" });
});
