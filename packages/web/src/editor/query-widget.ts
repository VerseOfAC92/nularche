// Speculum: ```query bloğunun altında canlı sonuç (bkz. core/src/query.ts). Origin her değiştiğinde (uygulamanın
// kendi kayıtları dahil) kısa bir gecikmeyle yeniden çalışır. Sonuçtaki notlar tıklanınca açılır; görevler
// işaretlenince ait oldukları notta işaretlenir.

import type { QueryResult } from "../../../core/src/query.ts";
import { api } from "../api.ts";
import { t } from "../i18n/index.ts";

export const ORIGIN_CHANGED = "nularche:origin-changed";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function noteLink(id: string, title: string, icon?: string): HTMLElement {
  const a = el("button", "query-link", `${icon ? `${icon} ` : ""}${title}`);
  a.type = "button";
  a.addEventListener("mousedown", (e) => e.preventDefault());
  a.addEventListener("click", () => (location.hash = encodeURIComponent(id)));
  return a;
}

function render(box: HTMLElement, r: QueryResult): void {
  box.replaceChildren();
  const head = el("div", "query-head");
  head.append(el("span", "query-badge", "Speculum"), el("span", "muted small", t("query.count", { n: r.total })));
  box.append(head);
  for (const e of r.errors) box.append(el("div", "error-text small", e));
  if (r.show === "count") {
    box.append(el("div", "query-big", String(r.total)));
    return;
  }
  if (r.show === "tasks") {
    if (!r.tasks.length) box.append(el("div", "muted small", t("query.noTasks")));
    const ul = el("ul", "query-tasks");
    for (const task of r.tasks) {
      const li = el("li");
      const cb = el("input");
      cb.type = "checkbox";
      cb.addEventListener("mousedown", (e) => e.preventDefault());
      cb.addEventListener("change", () => void completeTask(task.id, task.line, cb));
      li.append(cb, el("span", undefined, ` ${task.text} `), noteLink(task.id, task.title));
      ul.append(li);
    }
    box.append(ul);
    return;
  }
  if (!r.rows.length) {
    box.append(el("div", "muted small", t("query.empty")));
    return;
  }
  if (r.show === "table") {
    const table = el("table", "query-table");
    const tr = el("tr");
    tr.append(el("th", undefined, t("query.note")), ...r.columns.map((c) => el("th", undefined, c)));
    table.append(tr);
    for (const row of r.rows) {
      const line = el("tr");
      const first = el("td");
      first.append(noteLink(row.id, row.title, row.icon));
      line.append(first, ...r.columns.map((c) => el("td", undefined, row.values[c] ?? "")));
      table.append(line);
    }
    box.append(table);
  } else {
    const ul = el("ul", "query-list");
    for (const row of r.rows) {
      const li = el("li");
      li.append(noteLink(row.id, row.title, row.icon));
      for (const c of r.columns) if (row.values[c]) li.append(el("span", "muted small", ` · ${row.values[c]}`));
      ul.append(li);
    }
    box.append(ul);
  }
  if (r.total > r.rows.length) box.append(el("div", "muted small", t("query.more", { n: r.total - r.rows.length })));
}

async function completeTask(id: string, line: number, cb: HTMLInputElement): Promise<void> {
  cb.disabled = true;
  try {
    const d = await api.read(id);
    const lines = d.body.split("\n");
    if (/^[ \t]*[-*+] \[ \]/.test(lines[line] ?? "")) {
      lines[line] = lines[line].replace("[ ]", "[x]");
      await api.update(id, { body: lines.join("\n"), baseRevision: d.revision });
    }
  } catch {
    cb.checked = false;
    cb.disabled = false;
  }
}

/** Sorgu bloğunun altındaki sonuç kutusu. */
export function queryWidget(code: string): HTMLElement {
  const box = el("div", "query-render");
  box.contentEditable = "false";
  box.textContent = "…";
  let timer: number | undefined;
  const run = () => {
    if (!box.isConnected) return void window.removeEventListener(ORIGIN_CHANGED, schedule);
    const selfId = box.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
    fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: code, selfId }) })
      .then((res) => res.json() as Promise<QueryResult>)
      .then((r) => render(box, r))
      .catch((e) => (box.textContent = String(e)));
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, 400);
  };
  window.addEventListener(ORIGIN_CHANGED, schedule);
  requestAnimationFrame(run);
  return box;
}
