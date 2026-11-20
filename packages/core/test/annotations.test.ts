import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanAnnotations, NodeStore, readAnnotations, writeAnnotations } from "../src/index.ts";

test("Lectern işaretlemeleri: doğrulanır, saklanır, PDF yeniden adlandırılınca taşınır", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-ann-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  await mkdir(path.join(root, "Attachments"), { recursive: true });
  await writeFile(path.join(root, "Attachments", "makale.pdf"), "%PDF-1.4\n");
  const good = { id: "hl-a1", page: 2, rects: [[0.1, 0.2, 0.3, 0.02]], text: "önemli cümle", color: "green", comment: "not" };
  const bad = [{ id: "../x", page: 1, rects: [[0, 0, 1, 1]] }, { id: "hl-b", page: 0, rects: [[0, 0, 1, 1]] }, { id: "hl-c", page: 1, rects: [[5, 0, 1, 1]] }];
  const saved = await writeAnnotations(root, "Attachments/makale.pdf", { highlights: [good, ...bad], noteId: "abc", lastPage: 3 });
  assert.equal(saved.highlights.length, 1, "geçersiz vurgular atlanır");
  assert.equal(saved.highlights[0].color, "green");
  assert.equal((await readAnnotations(root, "Attachments/makale.pdf")).highlights[0].comment, "not");
  assert.equal(cleanAnnotations("x.pdf", { highlights: [{ ...good, color: "red" }] }).highlights[0].color, "yellow");

  const moved = await store.renameAttachment("Attachments/makale.pdf", "yeni ad");
  const after = await readAnnotations(root, moved);
  assert.equal(after.highlights.length, 1);
  assert.equal(after.path, moved);
  assert.equal((await readAnnotations(root, "Attachments/makale.pdf")).highlights.length, 0);
});
