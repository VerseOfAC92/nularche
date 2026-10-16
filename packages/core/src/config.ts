import path from "node:path";
import { fileURLToPath } from "node:url";

/** Kaynak koddan çalışırken proje kökü (`packages/core/src` üç seviye yukarıda). Paketli uygulamada kullanılmaz. */
export function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

/** Origin (not kasası) klasörü: `NULARCHE_ORIGIN` ortam değişkeni, yoksa kaynak kodda `<proje>/origin`. */
export function resolveOriginDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.NULARCHE_ORIGIN || path.join(projectRoot(), "origin"));
}
