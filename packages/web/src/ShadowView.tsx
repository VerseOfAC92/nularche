// Shadow: henüz bir Arche'ye bağlanmamış ham notlar (gelen kutusu) ve hiçbir Node ile
// bağlantısı olmayan Node'lar. Amaç dağınık fikirleri yakalayıp bilgi ağına bağlamak.

import { useEffect, useState } from "react";
import { api, type NodeMeta, type ShadowView as ShadowData } from "./api.ts";

const ago = (ms: number) => {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "az önce";
  if (d < 3600) return `${Math.floor(d / 60)} dk önce`;
  if (d < 86400) return `${Math.floor(d / 3600)} sa önce`;
  return new Date(ms).toLocaleDateString("tr-TR");
};

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
    onToast("Shadow'a yakalandı.");
  }

  async function moveTo(n: NodeMeta, target: string) {
    await api.move(n.id, target === "__root" ? null : target);
    onChanged();
    onToast(target === "__root" ? `“${n.title}” artık bir Arche.` : `“${n.title}” taşındı.`);
  }

  const item = (n: NodeMeta, withMove: boolean) => (
    <div className="shadow-item" key={n.id}>
      <span>{n.icon ?? "◇"}</span>
      <span className="t" onClick={() => onOpen(n.id)}>
        {n.title}
      </span>
      <small>{ago(n.updatedAt)}</small>
      {withMove && (
        <select value="" onChange={(e) => e.target.value && moveTo(n, e.target.value)} title="Bir Arche'ye bağla">
          <option value="">Bağla…</option>
          <option value="__root">◈ Yeni Arche yap</option>
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
      <p className="muted">Henüz hiçbir Arche'ye bağlanmamış ham notlar ve bağlantısız fikirler. Yakalayın, sonra bilgi ağınıza bağlayın.</p>
      <div className="capture">
        <textarea
          placeholder="Aklınızdakini yazın… (⌘Enter ile yakala)"
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
          Yakala
        </button>
      </div>

      <h2 className="section-title">Gelen kutusu · {data?.inbox.length ?? 0}</h2>
      <div className="shadow-list">
        {data?.inbox.map((n) => item(n, true))}
        {data && data.inbox.length === 0 && <p className="empty">Gelen kutusu boş.</p>}
      </div>

      <h2 className="section-title">Bağlantısız Node'lar · {data?.unlinked.length ?? 0}</h2>
      <p className="muted">
        Bu Node'lar hiçbir Node'a bağlantı vermiyor ve bağlantı almıyor. Birbirleriyle ilişkilendirmek için açıp “[[” ile bağlayın.
      </p>
      <div className="shadow-list">
        {data?.unlinked.map((n) => item(n, false))}
        {data && data.unlinked.length === 0 && <p className="empty">Hepsi bağlantılı.</p>}
      </div>
    </div>
  );
}
