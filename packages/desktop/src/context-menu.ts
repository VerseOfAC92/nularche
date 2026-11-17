// Sağ tık menüsü: uygulamanın tıklanan yere özgü seçenekleri (Arayüz bunları gönderir) ile işletim sisteminin
// seçenekleri (kes/kopyala/yapıştır, yazım önerileri, sözlükte arama, paylaşma, konuşma, hizmetler, bağlantı ve
// görsel işlemleri) tek bir yerel menüde birlikte açılır.

import { clipboard, ipcMain, Menu, shell, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from "electron";
import { d } from "./i18n.ts";

/** Arayüzün gönderdiği menü öğesi (yalnızca veri; tıklama Arayüze kimliğiyle geri bildirilir). */
interface AppItem {
  id?: string;
  label?: string;
  type?: "separator";
  enabled?: boolean;
  checked?: boolean;
  accelerator?: string;
  submenu?: AppItem[];
}

const pending = new Map<number, AppItem[]>();
let registered = false;

function parseItems(raw: unknown, depth = 0): AppItem[] {
  if (!Array.isArray(raw) || depth > 2) return [];
  return raw.slice(0, 40).flatMap((x): AppItem[] => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    if (o.type === "separator") return [{ type: "separator" }];
    if (typeof o.label !== "string" || !o.label) return [];
    return [
      {
        id: typeof o.id === "string" ? o.id : undefined,
        label: o.label.slice(0, 120),
        enabled: o.enabled !== false,
        checked: typeof o.checked === "boolean" ? o.checked : undefined,
        accelerator: typeof o.accelerator === "string" ? o.accelerator : undefined,
        submenu: o.submenu ? parseItems(o.submenu, depth + 1) : undefined,
      },
    ];
  });
}

function toTemplate(items: AppItem[], wc: WebContents): MenuItemConstructorOptions[] {
  return items.map((it) =>
    it.type === "separator"
      ? { type: "separator" }
      : {
          label: it.label,
          enabled: it.enabled,
          type: it.checked === undefined ? undefined : "checkbox",
          checked: it.checked,
          accelerator: it.accelerator,
          registerAccelerator: false,
          submenu: it.submenu?.length ? toTemplate(it.submenu, wc) : undefined,
          click: it.id ? () => wc.send("nularche:ctx-run", it.id) : undefined,
        },
  );
}

/** İşletim sisteminin seçenekleri: tıklanan yere göre (yazı alanı, seçili metin, bağlantı, görsel). */
function systemItems(p: ContextMenuParams, wc: WebContents): MenuItemConstructorOptions[] {
  const mac = process.platform === "darwin";
  const out: MenuItemConstructorOptions[][] = [];
  const word = p.selectionText.trim();
  if (p.misspelledWord) {
    const fixes: MenuItemConstructorOptions[] = p.dictionarySuggestions.length
      ? p.dictionarySuggestions.slice(0, 6).map((s) => ({ label: s, click: () => wc.replaceMisspelling(s) }))
      : [{ label: d("ctx.noSuggestions"), enabled: false }];
    fixes.push({ label: d("ctx.addWord"), click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    out.push(fixes);
  }
  if (mac && word && word.length < 80) out.push([{ label: d("ctx.lookUp", { word: word.length > 24 ? `${word.slice(0, 24)}…` : word }), click: () => wc.showDefinitionForSelection() }]);
  if (p.linkURL && /^(https?|mailto):/i.test(p.linkURL)) {
    out.push([
      { label: d("ctx.openLink"), click: () => void shell.openExternal(p.linkURL) },
      { label: d("ctx.copyLink"), click: () => clipboard.writeText(p.linkURL) },
    ]);
  }
  if (p.mediaType === "image" && p.srcURL) out.push([{ label: d("ctx.copyImage"), click: () => wc.copyImageAt(p.x, p.y) }]);
  const edit: MenuItemConstructorOptions[] = [];
  if (p.isEditable) edit.push({ label: d("ctx.cut"), role: "cut", enabled: p.editFlags.canCut });
  if (p.isEditable || word) edit.push({ label: d("ctx.copy"), role: "copy", enabled: p.editFlags.canCopy });
  if (p.isEditable) {
    edit.push({ label: d("ctx.paste"), role: "paste", enabled: p.editFlags.canPaste });
    edit.push({ label: d("ctx.pasteMatch"), role: "pasteAndMatchStyle", enabled: p.editFlags.canPaste });
  }
  if (p.isEditable || word) edit.push({ label: d("ctx.selectAll"), role: "selectAll", enabled: p.editFlags.canSelectAll });
  if (edit.length) out.push(edit);
  if (word) {
    const extra: MenuItemConstructorOptions[] = [];
    if (mac) {
      extra.push({ label: d("ctx.share"), role: "shareMenu", sharingItem: { texts: [p.selectionText] } });
      extra.push({ label: d("ctx.speech"), submenu: [{ label: d("ctx.startSpeaking"), role: "startSpeaking" }, { label: d("ctx.stopSpeaking"), role: "stopSpeaking" }] });
    } else {
      extra.push({ label: d("ctx.searchWeb"), click: () => void shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(word)}`) });
    }
    out.push(extra);
  }
  if (mac && (word || p.isEditable)) out.push([{ label: d("ctx.services"), role: "services" }]);
  return out.flatMap((group, i) => (i ? [{ type: "separator" as const }, ...group] : group));
}

/** Bir pencereye sağ tık menüsünü bağlar. */
export function attachContextMenu(w: BrowserWindow): void {
  if (!registered) {
    registered = true;
    // Arayüz, sağ tık olayında öğelerini eşzamanlı gönderir; menü olayından önce elimizde olur.
    ipcMain.on("nularche:ctx-items", (e, raw: unknown) => {
      pending.set(e.sender.id, parseItems(raw));
      e.returnValue = true;
    });
  }
  const wc = w.webContents;
  wc.on("context-menu", (_e, params) => {
    const app = pending.get(wc.id) ?? [];
    pending.delete(wc.id);
    const sys = systemItems(params, wc);
    const template: MenuItemConstructorOptions[] = [...toTemplate(app, wc), ...(app.length && sys.length ? [{ type: "separator" as const }] : []), ...sys];
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: w });
  });
  wc.on("destroyed", () => pending.delete(wc.id));
}
