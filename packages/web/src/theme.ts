// Görünüm tercihi (koyu / açık / sistem). Varsayılan "sistem": işletim sisteminin koyu/açık teması
// anında izlenir. Masaüstünde seçim uygulama ayarlarında saklanır (yerel sunucunun portu her açılışta
// değiştiği için tarayıcı deposu orada kalıcı değildir); tarayıcı sürümünde localStorage kullanılır.

import { desktop } from "./desktop.ts";

export type ThemeChoice = "dark" | "light" | "system";
const KEY = "nlc-theme";

const isChoice = (v: unknown): v is ThemeChoice => v === "dark" || v === "light" || v === "system";

function initial(): ThemeChoice {
  if (desktop && isChoice(desktop.theme)) return desktop.theme;
  try {
    const v = localStorage.getItem(KEY);
    if (isChoice(v)) return v;
  } catch {
    // depolama kapalı
  }
  return "system";
}

let current: ThemeChoice = initial();

export function getTheme(): ThemeChoice {
  return current;
}
const media = matchMedia("(prefers-color-scheme: light)");

export function applyTheme(choice: ThemeChoice = current): void {
  const light = choice === "light" || (choice === "system" && media.matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
}

export function setTheme(choice: ThemeChoice): void {
  current = choice;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // depolama kapalıysa yalnızca bu oturum için uygula
  }
  void desktop?.setTheme(choice);
  applyTheme(choice);
}

media.addEventListener("change", () => applyTheme());
