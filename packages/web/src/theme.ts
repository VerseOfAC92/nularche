// Görünüm tercihi (koyu / açık / sistem). Yalnızca bu cihaza özgü bir kolaylık olduğu için tarayıcı deposunda tutulur.

export type ThemeChoice = "dark" | "light" | "system";
const KEY = "nlc-theme";

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "system" ? v : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(choice: ThemeChoice = getTheme()): void {
  const light = choice === "light" || (choice === "system" && matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
}

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // depolama kapalıysa yalnızca bu oturum için uygula
  }
  applyTheme(choice);
}

matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => applyTheme());
