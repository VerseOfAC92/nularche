// Manuskript (2.0): notları bölümler halinde sıralayıp tek bir eser gibi okuma, sayma ve dışa aktarma.
// Notlar yerinde kalır; manuskript yalnızca sırayı tutar. Bir taslağı (outline) izleyebilir: taslakta olup henüz
// yazılmamış sahneler "planlanan" olarak görünür ve tek tıkla not olarak açılır.

import { useEffect, useMemo, useState } from "react";
import { api, type CompiledManuscript, type NodeMeta } from "../api.ts";
import { desktop } from "../desktop.ts";
import { safeHtml } from "../editor/linked-nodes.tsx";
import { toEditorMarkdown } from "../editor/paths.ts";
import { exportNode, type ExportKind } from "../exporting.ts";
import { t } from "../i18n/index.ts";
import { NotePicker } from "../vault/Palettes.tsx";
import { askText } from "../ask.tsx";
import { newWritingId, parseWriting, planFromOutline, serializeWriting, writingBody, type OutlineData } from "../../../core/src/writing.ts";
import { colorOf, moveItem, useWriting } from "./useWriting.ts";
import { ColorDots, Progress } from "./ui.tsx";

type Drag = { section: number; index: number } | null;

export function ManuscriptView({
  id,
  path,
  body,
  goal,
  nodes,
  onChange,
  onOpen,
  onChanged,
  onToast,
  onFlush,
}: {
  id: string;
  path: string;
  body: string;
  goal?: number;
  nodes: NodeMeta[];
  onChange: (body: string) => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
  onFlush: () => Promise<void>;
}) {
  const { data, update, broken } = useWriting("manuscript", body, onChange);
  const [picker, setPicker] = useState<number | null>(null);
  const [outlinePick, setOutlinePick] = useState(false);
  const [reading, setReading] = useState<CompiledManuscript | null>(null);
  const [options, setOptions] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [drag, setDrag] = useState<Drag>(null);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [outline, setOutline] = useState<{ id: string; data: OutlineData } | null>(null);
  const byPath = useMemo(() => new Map(nodes.map((n) => [n.path, n])), [nodes]);
  const used = useMemo(() => new Set(data.sections.flatMap((s) => s.items.map((i) => i.file))), [data]);
  const total = data.sections.reduce((n, s) => n + s.items.reduce((m, i) => m + (byPath.get(i.file)?.words ?? 0), 0), 0);

  // İzlenen taslak.
  const outlineNode = data.outline ? byPath.get(data.outline) : undefined;
  useEffect(() => {
    if (!outlineNode) return setOutline(null);
    api.read(outlineNode.id).then((d) => setOutline({ id: d.id, data: parseWriting("outline", d.body).data }), () => setOutline(null));
  }, [outlineNode?.id, outlineNode?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = outline ? planFromOutline(outline.data, data).filter((p) => !p.written) : [];

  if (broken) return <p className="banner error">{t("ws.broken")}</p>;

  const addFile = (section: number, n: NodeMeta) => {
    if (used.has(n.path)) return onToast(t("ws.alreadyIn"));
    update((d) => (d.sections[section].items.push({ id: newWritingId(), file: n.path }), d));
  };

  const newChapter = async (section: number, title?: string, outlineRow?: string) => {
    const name = title ?? (await askText(t("ws.chapterTitle"), t("ws.untitledChapter")))?.trim();
    if (!name) return;
    await onFlush();
    const created = await api.create(name, id);
    update((d) => (d.sections[Math.min(section, d.sections.length - 1)].items.push({ id: newWritingId(), file: created.path }), d));
    // Alt not eklenince manuskript klasör notuna geçer; yol değişmiş olabilir — NodeView yeniden yükler.
    if (outlineRow && outline) {
      const od = await api.read(outline.id);
      const parsed = parseWriting("outline", od.body).data;
      const row = parsed.rows.find((r) => r.id === outlineRow);
      if (row) {
        row.file = (await api.read(created.id)).path;
        await api.update(od.id, { body: serializeWriting("outline", od.body, parsed), baseRevision: od.revision });
      }
    }
    onChanged();
    onOpen(created.id);
  };

  const createOutline = async () => {
    const rows: OutlineData["rows"] = [];
    for (const s of data.sections) {
      const titled = !!s.title.trim();
      if (titled) rows.push({ id: newWritingId(), text: s.title, depth: 0 });
      for (const i of s.items) rows.push({ id: newWritingId(), text: byPath.get(i.file)?.title ?? i.file, depth: titled ? 1 : 0, file: i.file });
    }
    const me = nodes.find((n) => n.id === id);
    await onFlush();
    const o = await api.create(t("ws.outlineOf", { title: me?.title ?? "" }), me?.parentNodeId ?? (me?.archeId === null ? "shadow" : null), writingBody("outline", { version: 1, rows }), { layout: "outline", icon: "🗂" });
    update((d) => ({ ...d, outline: o.path }));
    onChanged();
    onToast(t("ws.outlineCreated"));
  };

  const drop = (section: number, index: number) => {
    if (!drag) return;
    update((d) => {
      const [item] = d.sections[drag.section].items.splice(drag.index, 1);
      const at = drag.section === section && drag.index < index ? index - 1 : index;
      d.sections[section].items.splice(at, 0, item);
      return d;
    });
    setDrag(null);
  };

  const doExport = async (kind: ExportKind | "pdf") => {
    setExportMenu(false);
    await onFlush();
    try {
      if (kind === "pdf") {
        setReading(await api.manuscript(id));
        await new Promise((r) => setTimeout(r, 300));
        const out = desktop ? await desktop.printPdf(nodes.find((n) => n.id === id)?.title ?? "Manuscript") : (window.print(), null);
        if (out) onToast(t("node.pdfSaved", { path: out }));
        return;
      }
      const out = await exportNode(kind, id);
      if (out) onToast(out === "downloaded" ? t("export.downloaded") : t("export.saved", { path: out }));
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  const toolbar = (
    <div className="ws-toolbar">
      <Progress value={reading?.words ?? total} goal={goal} label={t("ws.totalWords", { n: (reading?.words ?? total).toLocaleString() })} />
      <span className="grow" />
      {reading ? (
        <button className="secondary" onClick={() => setReading(null)}>
          ✎ {t("ws.backToPlan")}
        </button>
      ) : (
        <button className="secondary" onClick={async () => (await onFlush(), setReading(await api.manuscript(id)))}>
          📖 {t("ws.read")}
        </button>
      )}
      <div className="rel">
        <button className="secondary" onClick={() => setExportMenu((v) => !v)}>
          ⇩ {t("ws.export")}
        </button>
        {exportMenu && (
          <div className="menu-pop" onMouseLeave={() => setExportMenu(false)}>
            <button onClick={() => void doExport("docx")}>{t("cmd.exportDocx")}</button>
            <button onClick={() => void doExport("pdf")}>{t("node.savePdf")}</button>
            <button onClick={() => void doExport("rtf")}>{t("cmd.exportRtf")}</button>
            <button onClick={() => void doExport("txt")}>{t("cmd.exportTxt")}</button>
            <button onClick={() => void doExport("html")}>{t("export.html")}</button>
          </div>
        )}
      </div>
      <button className={`secondary ${options ? "on" : ""}`} onClick={() => setOptions((v) => !v)} title={t("ws.options")}>
        ⚙︎
      </button>
    </div>
  );

  if (reading) {
    const missing = reading.sections.flatMap((s) => s.parts.filter((p) => p.missing));
    return (
      <div className="ws-view ws-manuscript">
        {toolbar}
        {missing.length > 0 && <p className="banner">{t("ws.missingParts", { list: missing.map((m) => m.title).join(", ") })}</p>}
        <div className="ws-read" dangerouslySetInnerHTML={{ __html: safeHtml(toEditorMarkdown(reading.markdown, path)) }} />
      </div>
    );
  }

  return (
    <div className="ws-view ws-manuscript">
      {toolbar}
      {options && (
        <div className="ws-options">
          <label className="check">
            <input type="checkbox" checked={data.options.sectionTitles} onChange={(e) => update((d) => ((d.options.sectionTitles = e.target.checked), d))} /> {t("ws.optSectionTitles")}
          </label>
          <label className="check">
            <input type="checkbox" checked={data.options.fileTitles} onChange={(e) => update((d) => ((d.options.fileTitles = e.target.checked), d))} /> {t("ws.optFileTitles")}
          </label>
          <label className="field inline">
            <span>{t("ws.optSeparator")}</span>
            <input value={data.options.separator} maxLength={40} placeholder={t("ws.none")} onChange={(e) => update((d) => ((d.options.separator = e.target.value), d))} />
          </label>
          <div className="row">
            {outlineNode ? (
              <>
                <span className="muted small">
                  {t("ws.following")} <a onClick={() => onOpen(outlineNode.id)}>🗂 {outlineNode.title}</a>
                </span>
                <button className="secondary small-btn" onClick={() => update((d) => ({ ...d, outline: undefined }))}>
                  {t("ws.stopFollowing")}
                </button>
              </>
            ) : (
              <>
                <button className="secondary small-btn" onClick={() => setOutlinePick(true)}>
                  🗂 {t("ws.followOutline")}
                </button>
                <button className="secondary small-btn" onClick={() => void createOutline()}>
                  ＋ {t("ws.createOutline")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {data.sections.map((s, si) => {
        const words = s.items.reduce((m, i) => m + (byPath.get(i.file)?.words ?? 0), 0);
        return (
          <section
            key={s.id}
            className="ms-section"
            style={{ borderLeftColor: colorOf(s.color) ?? "transparent" }}
            onDragOver={(e) => drag && e.preventDefault()}
            onDrop={() => drop(si, s.items.length)}
          >
            <header>
              <input className="ms-section-title" value={s.title} placeholder={data.sections.length > 1 ? t("ws.untitledSection") : t("ws.sectionTitleHint")} onChange={(e) => update((d) => ((d.sections[si].title = e.target.value), d))} />
              <span className="muted small">{t("ws.words", { n: words.toLocaleString() })}</span>
              <div className="rel">
                <button className="icon-btn" title={t("ws.color")} onClick={() => setColorFor(colorFor === s.id ? null : s.id)}>
                  ●
                </button>
                {colorFor === s.id && (
                  <div className="pop anchored right" onMouseLeave={() => setColorFor(null)}>
                    <ColorDots value={s.color} onChange={(c) => (update((d) => ((d.sections[si].color = c), d)), setColorFor(null))} />
                  </div>
                )}
              </div>
              <button className="icon-btn" disabled={si === 0} title={t("ws.moveUp")} onClick={() => update((d) => ({ ...d, sections: moveItem(d.sections, si, si - 1) }))}>
                ↑
              </button>
              <button className="icon-btn" disabled={si === data.sections.length - 1} title={t("ws.moveDown")} onClick={() => update((d) => ({ ...d, sections: moveItem(d.sections, si, si + 1) }))}>
                ↓
              </button>
              {data.sections.length > 1 && (
                <button
                  className="icon-btn"
                  title={t("ws.deleteSection")}
                  onClick={() => {
                    if (s.items.length && !confirm(t("ws.deleteSectionConfirm", { n: s.items.length }))) return;
                    update((d) => {
                      const [gone] = d.sections.splice(si, 1);
                      // Notlar silinmez: önceki (ya da sonraki) bölüme geçer.
                      d.sections[Math.max(0, si - 1)].items.push(...gone.items);
                      return d;
                    });
                  }}
                >
                  ✕
                </button>
              )}
            </header>
            <ol className="ms-items">
              {s.items.map((it, ii) => {
                const n = byPath.get(it.file);
                return (
                  <li
                    key={it.id}
                    draggable
                    className={`ms-item ${n ? "" : "missing"} ${drag?.section === si && drag.index === ii ? "dragging" : ""}`}
                    onDragStart={(e) => (e.dataTransfer.setData("text/plain", it.file), setDrag({ section: si, index: ii }))}
                    onDragEnd={() => setDrag(null)}
                    onDragOver={(e) => drag && e.preventDefault()}
                    onDrop={(e) => (e.stopPropagation(), drop(si, ii))}
                  >
                    <span className="drag-handle" aria-hidden>
                      ⋮⋮
                    </span>
                    <span className="ms-icon">{n?.icon ?? "📄"}</span>
                    {n ? (
                      <a className="ms-title" onClick={() => onOpen(n.id)} data-path={n.path}>
                        {n.title}
                      </a>
                    ) : (
                      <span className="ms-title muted" title={it.file}>
                        {t("ws.missingFile", { file: it.file.replace(/\.md$/, "") })}
                      </span>
                    )}
                    <span className="muted small">{n ? t("ws.words", { n: n.words.toLocaleString() }) : ""}</span>
                    <button className="icon-btn" title={t("ws.removeFromManuscript")} onClick={() => update((d) => (d.sections[si].items.splice(ii, 1), d))}>
                      ✕
                    </button>
                  </li>
                );
              })}
              {!s.items.length && <li className="muted small ms-empty">{t("ws.emptySection")}</li>}
            </ol>
            <div className="row ms-actions">
              <button className="secondary small-btn" onClick={() => setPicker(si)}>
                ＋ {t("ws.addExisting")}
              </button>
              <button className="secondary small-btn" onClick={() => void newChapter(si)}>
                ✎ {t("ws.newChapter")}
              </button>
            </div>
          </section>
        );
      })}
      <button className="secondary" onClick={() => update((d) => (d.sections.push({ id: newWritingId(), title: "", items: [] }), d))}>
        ＋ {t("ws.addSection")}
      </button>

      {plan.length > 0 && (
        <section className="ms-plan">
          <h4>
            {t("ws.planned")} <span className="muted small">· {outlineNode?.title}</span>
          </h4>
          {plan.map((p) => (
            <div key={p.row.id} className="ms-planned" style={{ borderLeftColor: colorOf(p.row.color) ?? undefined }}>
              <div className="grow">
                <b>{p.row.text || t("ws.untitledRow")}</b>
                {p.row.notes && <p className="muted small">{p.row.notes}</p>}
                {p.beats.length > 0 && (
                  <ul className="ms-beats" aria-label={t("ws.beats")}>
                    {p.beats.map((b) => (
                      <li key={b.id} style={{ marginLeft: (b.depth - p.row.depth - 1) * 14 }}>
                        {b.text || "…"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button className="secondary small-btn" onClick={() => void newChapter(data.sections.length - 1, p.row.text || t("ws.untitledChapter"), p.row.id)}>
                ✎ {t("ws.writeIt")}
              </button>
            </div>
          ))}
        </section>
      )}

      {picker !== null && (
        <NotePicker
          nodes={nodes.filter((n) => n.id !== id && !used.has(n.path) && !n.database && n.layoutMode === "stream" && !n.template)}
          placeholder={t("ws.pickNote")}
          onClose={() => setPicker(null)}
          onPick={(n) => addFile(picker, n)}
        />
      )}
      {outlinePick && (
        <NotePicker
          nodes={nodes.filter((n) => n.layoutMode === "outline")}
          placeholder={t("ws.pickOutline")}
          onClose={() => setOutlinePick(false)}
          onPick={(n) => update((d) => ({ ...d, outline: n.path }))}
        />
      )}
    </div>
  );
}
