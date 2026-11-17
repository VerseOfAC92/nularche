// Sağ tık menüsü (Arayüz tarafı): tıklanan yerdeki bileşenler `addContextItems` ile kendi seçeneklerini ekler;
// masaüstü uygulaması bunları işletim sisteminin seçenekleriyle (kopyala, yazım önerileri, sözlükte ara…) aynı
// yerel menüde gösterir. Tarayıcıda tarayıcının kendi menüsü açılır.

import { desktop } from "./desktop.ts";

export interface ContextItem {
  label: string;
  run?: () => void;
  enabled?: boolean;
  checked?: boolean;
  submenu?: ContextItem[];
}
export type ContextEntry = ContextItem | "separator";

let groups: ContextEntry[][] = [];
const handlers = new Map<string, () => void>();
let seq = 0;

/** Sağ tık olayında çağrılır: en içteki bileşenin seçenekleri önce gelir. */
export function addContextItems(items: ContextEntry[]): void {
  const clean = items.filter((x) => x === "separator" || x.label);
  if (clean.length) groups.push(clean);
}

function serialize(entries: ContextEntry[]): unknown[] {
  return entries.map((e) => {
    if (e === "separator") return { type: "separator" };
    let id: string | undefined;
    if (e.run) {
      id = `c${++seq}`;
      handlers.set(id, e.run);
    }
    return { id, label: e.label, enabled: e.enabled !== false, checked: e.checked, submenu: e.submenu ? serialize(e.submenu) : undefined };
  });
}

export function installContextMenu(): void {
  if (!desktop?.contextItems) return;
  window.addEventListener("contextmenu", () => (groups = []), true);
  // Kabarcıklanma aşamasının sonunda (React işleyicileri çalıştıktan sonra) öğeler masaüstüne gönderilir.
  window.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    handlers.clear();
    const flat = groups.flatMap((g, i) => (i ? (["separator", ...g] as ContextEntry[]) : g));
    groups = [];
    desktop!.contextItems!(serialize(flat));
  });
  desktop.onContextRun?.((id) => handlers.get(id)?.());
}
