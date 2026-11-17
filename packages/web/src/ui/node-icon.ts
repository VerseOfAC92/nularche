// Kullanıcının simge vermediği Node'lar için türüne göre çizgi simge. Kullanıcının seçtiği simge (emoji) her zaman
// önce gelir; bu yalnızca boşluğu doldurur.

import type { IconName } from "./Icon.tsx";

const BY_LAYOUT: Record<string, IconName> = {
  manuscript: "book",
  outline: "list-tree",
  cards: "layout-grid",
  wiki: "books",
  whiteboard: "chalkboard",
  canvas: "puzzle",
};

export function nodeIconName(n: { id: string; database?: unknown; layoutMode?: string; archeId?: string | null; parentNodeId?: string | null }): IconName {
  if (n.database) return "table";
  if (n.layoutMode && BY_LAYOUT[n.layoutMode]) return BY_LAYOUT[n.layoutMode];
  if (n.parentNodeId === null && n.archeId === n.id) return "diamond";
  return "file";
}
