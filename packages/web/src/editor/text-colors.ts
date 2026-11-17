// Not ve başlık editörlerinin ortak yazı renkleri (boş değer: varsayılan renk).

import type { StringKey } from "../i18n/index.ts";

export const TEXT_COLORS: [StringKey, string][] = [
  ["ed.color.default", ""],
  ["ed.color.gray", "#8b949e"],
  ["ed.color.cyan", "#00a8b5"],
  ["ed.color.blue", "#2f81f7"],
  ["ed.color.green", "#3fb950"],
  ["ed.color.yellow", "#d29922"],
  ["ed.color.orange", "#f0883e"],
  ["ed.color.red", "#f85149"],
  ["ed.color.purple", "#a371f7"],
] as const;
