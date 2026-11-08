// Shadow: henüz bir Arche'ye bağlanmamış ham notlar (gelen kutusu) ve hiçbir Node ile
// bağlantısı olmayan Node'lar. Amaç dağınık fikirleri yakalayıp bilgi ağına bağlamak.

import { useEffect, useState } from "react";
import { api, type CaptureKind, type NodeMeta, type ShadowView as ShadowData } from "./api.ts";

import { ago, t } from "./i18n/index.ts";
import { keys, modPressed } from "./shortcuts.tsx";

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
    try {
      const res = await api.capture(text);
      setText("");
      onChanged();
      onToast("routed" in res ? t("ws.routedTo", { title: res.routed.targetTitle }) : t("shadow.captured"));
    } catch (e) {
      onToast((e as Error).message);
    }
  }

  /** Shadow notunu kart destesine, taslağa, wiki'ye ya da bir nota yapılacak olarak gönderir. */
  async function promote(n: NodeMeta, value: string) {
    const [kind, target] = value.split(":") as [CaptureKind | "auto", string];
    try {
      const res = await api.promote(n.id, kind === "auto" ? {} : { kind, target });
      onChanged();
      onToast(t("ws.routedTo", { title: res.targetTitle }));
    } catch (e) {
      onToast((e as Error).message);
    }
  }
  // Yapılacak hedefleri: sık kullanılan ve sabitlenmiş notlar.
  const taskTargets = nodes.filter((x) => (x.favorite || x.pinned) && x.layoutMode === "stream" && !x.database && !x.locked && x.archeId !== null);
  const destinations = (["card", "outline", "wiki"] as CaptureKind[]).map((kind) => ({
    kind,
    nodes: nodes.filter((x) => !x.locked && (kind === "card" ? x.layoutMode === "cards" : kind === "outline" ? x.layoutMode === "outline" : kind === "wiki" ? x.layoutMode === "wiki" : false)),
  }));

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
      {withMove && (
        <select value="" onChange={(e) => e.target.value && void promote(n, e.target.value)} title={t("ws.promoteHint")}>
          <option value="">{t("ws.promote")}</option>
          {/^\s*::/.test(n.excerpt) && <option value="auto:">⚡ {t("ws.promoteAuto")}</option>}
          {destinations.map((d) =>
            d.nodes.length ? (
              <optgroup key={d.kind} label={t(`ws.ck.${d.kind}`)}>
                {d.nodes.map((x) => (
                  <option key={x.id} value={`${d.kind}:${x.id}`}>
                    {x.icon ?? "◇"} {x.title}
                  </option>
                ))}
              </optgroup>
            ) : null,
          )}
          {taskTargets.length > 0 && (
            <optgroup label={t("ws.ck.task")}>
              {taskTargets.map((x) => (
                <option key={x.id} value={`task:${x.id}`}>
                  {x.icon ?? "◇"} {x.title}
                </option>
              ))}
            </optgroup>
          )}
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
          placeholder={t("shadow.capturePlaceholder", { key: keys("Mod+Enter") })}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && modPressed(e)) {
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
