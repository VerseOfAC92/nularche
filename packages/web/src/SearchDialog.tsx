import { useEffect, useState } from "react";
import { api, type NodeMeta, type SearchHit } from "./api.ts";

export function SearchDialog({ onClose, onPick, nodes }: { onClose: () => void; onPick: (id: string) => void; nodes: NodeMeta[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!q.trim()) {
      const recent = [...nodes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
      setHits(recent.map((n) => ({ id: n.id, title: n.title, path: n.path, snippet: "" })));
      return;
    }
    const t = setTimeout(() => api.search(q).then((r) => (setHits(r), setActive(0))), 120);
    return () => clearTimeout(t);
  }, [q, nodes]);

  const icon = (id: string) => nodes.find((n) => n.id === id)?.icon ?? "◇";

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Origin'de ara…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && hits[active]) onPick(hits[active].id);
          }}
        />
        <div className="results">
          {!q && hits.length > 0 && (
            <div className="muted" style={{ padding: "4px 10px", fontSize: 12 }}>
              Son düzenlenenler
            </div>
          )}
          {hits.map((h, i) => (
            <button key={h.id} className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)} onClick={() => onPick(h.id)}>
              <span style={{ flexDirection: "row", gap: 8 }}>{icon(h.id)}</span>
              <span>
                <strong>{h.title}</strong>
                <small>{h.snippet || h.path.replace(/\.md$/, "")}</small>
              </span>
            </button>
          ))}
          {q && hits.length === 0 && <p className="empty">Sonuç yok</p>}
        </div>
      </div>
    </div>
  );
}
