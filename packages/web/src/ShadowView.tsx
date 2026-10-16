// Shadow: henüz bir Arche'ye bağlanmamış ham notlar (gelen kutusu) ve hiçbir Node ile
// bağlantısı olmayan Node'lar. Amaç dağınık fikirleri yakalayıp bilgi ağına bağlamak.

import { useEffect, useState } from "react";
import { api, type NodeMeta, type ShadowView as ShadowData } from "./api.ts";

import { ago, t } from "./i18n/index.ts";

export function ShadowView({
  nodes,
  changeTick,
  onOpen,
  onChanged,
  onToast,
}: {
  nodes: NodeMeta[];
  changeTick: number;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [data, setData] = useState<ShadowData | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    api.shadow().then(setData, () => undefined);
  }, [changeTick]);

  const arches = nodes.filter((n) => n.archeId === n.id);

  async function capture() {
    if (!text.trim()) return;
    await api.capture(text);
    setText("");
    onChanged();
    onToast(t("shadow.captured"));
  }

  async function moveTo(n: NodeMeta, target: string) {
    await api.move(n.id, target === "__root" ? null : target);
    onChanged();
    onToast(target === "__root" ? t("shadow.nowArche", { title: n.title }) : t("shadow.moved", { title: n.title }));
  }

  const item = (n: NodeMeta, withMove: boolean) => (
    <div className="shadow-item" key={n.id}>
      <span>{n.icon ?? "◇"}</span>
      <span className="t" onClick={() => onOpen(n.id)}>
        {n.title}
      </span>
      <small>{ago(n.updatedAt)}</small>
      {withMove && (
        <select value="" onChange={(e) => e.target.value && moveTo(n, e.target.value)} title={t("shadow.linkToArche")}>
          <option value="">{t("shadow.link")}</option>
          <option value="__root">◈ {t("shadow.makeArche")}</option>
          {arches.map((a) => (
            <option key={a.id} value={a.id}>
              {a.icon ?? "◈"} {a.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  return (
    <div className="shadow-view">
      <h1>◐ Shadow</h1>
      <p className="muted">{t("shadow.intro")}</p>
      <div className="capture">
        <textarea
          placeholder={t("shadow.capturePlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void capture();
            }
          }}
        />
        <button className="primary" onClick={capture} disabled={!text.trim()}>
          {t("shadow.capture")}
        </button>
      </div>

      <h2 className="section-title">{t("shadow.inbox")} · {data?.inbox.length ?? 0}</h2>
      <div className="shadow-list">
        {data?.inbox.map((n) => item(n, true))}
        {data && data.inbox.length === 0 && <p className="empty">{t("shadow.inboxEmpty")}</p>}
      </div>

      <h2 className="section-title">{t("shadow.unlinked")} · {data?.unlinked.length ?? 0}</h2>
      <p className="muted">
        {t("shadow.unlinkedHint")}
      </p>
      <div className="shadow-list">
        {data?.unlinked.map((n) => item(n, false))}
        {data && data.unlinked.length === 0 && <p className="empty">{t("shadow.allLinked")}</p>}
      </div>
    </div>
  );
}
