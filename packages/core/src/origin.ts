// Origin kimliği (RFC-001 §2): her Origin klasörü `.nularche/origin.json` içinde kalıcı bir id taşır.
// Derin bağlantılardaki `origin=` parametresi bu id ile eşleştirilir. Gizli klasör olduğu için
// Node taramasına girmez.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Origin {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

const META_DIR = ".nularche";

export async function loadOrigin(root: string): Promise<Origin> {
  const dir = path.join(root, META_DIR);
  const file = path.join(dir, "origin.json");
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    if (typeof data.id === "string" && typeof data.createdAt === "number") {
      return { id: data.id, createdAt: data.createdAt, name: path.basename(root), path: root };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" && !(err instanceof SyntaxError)) throw err;
  }
  const origin: Origin = { id: randomUUID(), name: path.basename(root), path: root, createdAt: Date.now() };
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${JSON.stringify({ id: origin.id, createdAt: origin.createdAt }, null, 2)}\n`);
  return origin;
}
