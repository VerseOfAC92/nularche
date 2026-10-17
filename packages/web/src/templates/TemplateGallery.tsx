// Şablon galerisi: hazır şablonlar ve kullanıcının "şablon" olarak işaretlediği sayfalar.
// Seçilen şablon yeni bir Arche olarak ya da açık sayfanın altına oluşturulur.

import { useState } from "react";
import { api, type NodeMeta, type ParentTarget } from "../api.ts";
import { getLang, t } from "../i18n/index.ts";
import { BUILTIN_TEMPLATES, instantiateBuiltin, type BuiltinTemplate } from "./builtins.ts";

export function TemplateGallery({
  nodes,
  currentId,
  onClose,
  onCreated,
  onToast,
}: {
  nodes: NodeMeta[];
  currentId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
  onToast: (msg: string) => void;
}) {
  const lang = getLang();
  const current = currentId ? nodes.find((n) => n.id === currentId && !n.database) : undefined;
  const [target, setTarget] = useState<"root" | "current">(current ? "current" : "root");
  const [busy, setBusy] = useState<string | null>(null);
  const mine = nodes.filter((n) => n.template && !nodes.find((p) => p.id === n.parentNodeId)?.database);
  const parent: ParentTarget = target === "current" && current ? current.id : null;

  async function run(key: string, action: () => Promise<{ id: string }>) {
    setBusy(key);
    try {
      const n = await action();
      onCreated(n.id);
      onClose();
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const useBuiltin = (tpl: BuiltinTemplate) => run(tpl.key, () => instantiateBuiltin(tpl, parent));
  const useMine = (n: NodeMeta) => run(n.id, () => api.duplicate(n.id, { parentNodeId: parent, title: n.title }));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog templates">
        <div className="dialog-head">
          <h2>📋 {t("tpl.title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="row-inline tpl-target">
          <span className="muted small">{t("tpl.createAs")}</span>
          <div className="segmented small">
            <button className={target === "root" ? "on" : ""} onClick={() => setTarget("root")}>
              ◈ {t("tpl.asArche")}
            </button>
            {current && (
              <button className={target === "current" ? "on" : ""} onClick={() => setTarget("current")}>
                ⤷ {t("tpl.under", { title: current.title })}
              </button>
            )}
          </div>
        </div>
        <h3>{t("tpl.builtin")}</h3>
        <div className="tpl-grid">
          {BUILTIN_TEMPLATES.map((tpl) => (
            <button key={tpl.key} className="tpl-card" disabled={!!busy} onClick={() => useBuiltin(tpl)}>
              <span className="tpl-icon">{tpl.icon}</span>
              <strong>{tpl.title[lang]}</strong>
              <span className="muted small">{tpl.description[lang]}</span>
              {busy === tpl.key && <span className="muted small">…</span>}
            </button>
          ))}
        </div>
        <h3>{t("tpl.mine")}</h3>
        {mine.length === 0 ? (
          <p className="muted small">{t("tpl.mineHint")}</p>
        ) : (
          <div className="tpl-grid">
            {mine.map((n) => (
              <button key={n.id} className="tpl-card" disabled={!!busy} onClick={() => useMine(n)}>
                <span className="tpl-icon">{n.icon ?? "📄"}</span>
                <strong>{n.title}</strong>
                {busy === n.id && <span className="muted small">…</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
