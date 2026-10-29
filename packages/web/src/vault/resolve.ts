// Arayüzdeki wiki hedefi çözücüsü (çekirdekteki wikiResolver ile aynı kural): önce yol, sonra başlık, dosya adı, takma ad.

import type { NodeMeta } from "../api.ts";

const key = (s: string) =>
  s
    .trim()
    .replace(/\.md$/i, "")
    .toLocaleLowerCase("tr");

export function makeResolver(nodes: NodeMeta[]): (name: string) => NodeMeta | null {
  const byPath = new Map<string, NodeMeta>();
  const byName = new Map<string, NodeMeta>();
  for (const n of nodes) {
    byPath.set(key(n.path), n);
    for (const name of [n.title, n.path.split("/").pop() ?? "", ...n.aliases]) {
      const k = key(name);
      if (k && !byName.has(k)) byName.set(k, n);
    }
  }
  return (name) => {
    const k = key(name);
    if (!k) return null;
    return byPath.get(k) ?? byName.get(k) ?? byName.get(key(name.split("/").pop() ?? "")) ?? null;
  };
}
