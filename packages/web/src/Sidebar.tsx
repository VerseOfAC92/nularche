// Kenar çubuğu: Origin başlığı, Shadow, favoriler ve Arche ağacı.
// Node'lar sürüklenerek başka bir Node'un altına, kardeşlerin arasına, köke (Arche) ya da Shadow'a bırakılabilir.

import { useMemo, useState, type DragEvent } from "react";
import { api, SHADOW, type NodeMeta, type ParentTarget } from "./api.ts";
import type { Route } from "./App.tsx";
import { t } from "./i18n/index.ts";
import { keys } from "./shortcuts.tsx";

const DRAG_TYPE = "application/x-nularche-node";

type DropZone = "before" | "inside" | "after";

export interface SidebarProps {
  nodes: NodeMeta[];
  route: Route;
  originName: string;
  shadowCount: number;
  trashCount: number;
  onNavigate: (route: Route) => void;
  onCreate: (parent: ParentTarget) => void;
  onTrash: (node: NodeMeta) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenTemplates: () => void;
  onDaily: () => void;
}

export function Sidebar(props: SidebarProps) {
  const { nodes, route } = props;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);
  const [dropTarget, setDropTarget] = useState<"shadow" | "root" | null>(null);

  const children = useMemo(() => {
    const map = new Map<string | null, NodeMeta[]>();
    const databases = new Set(nodes.filter((n) => n.database).map((n) => n.id));
    for (const n of nodes) {
      if (n.archeId === null) continue; // Shadow'dakiler ağaçta görünmez
      if (n.parentNodeId && databases.has(n.parentNodeId)) continue; // veritabanı satırları veritabanı görünümünde listelenir
      if (n.template) continue; // şablonlar "Şablonlar" bölümünde
      map.set(n.parentNodeId, [...(map.get(n.parentNodeId) ?? []), n]);
    }
    return map;
  }, [nodes]);

  // Seçili Node'un ataları açık olsun.
  const selectedId = route.kind === "node" ? route.id : null;
  const ancestors = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out = new Set<string>();
    let cur = selectedId ? byId.get(selectedId) : undefined;
    while (cur?.parentNodeId) {
      out.add(cur.parentNodeId);
      cur = byId.get(cur.parentNodeId);
    }
    return out;
  }, [nodes, selectedId]);

  const favorites = nodes.filter((n) => n.favorite);
  const templates = nodes.filter((n) => n.template && !(n.parentNodeId && nodes.find((p) => p.id === n.parentNodeId)?.database));

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      props.onChanged();
    }
  }

  function onDragStart(e: DragEvent, n: NodeMeta) {
    e.dataTransfer.setData(DRAG_TYPE, n.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function zoneFor(e: DragEvent<HTMLElement>): DropZone {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
  }

  function onRowDrop(e: DragEvent<HTMLElement>, target: NodeMeta) {
    e.preventDefault();
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const zone = zoneFor(e);
    setDrop(null);
    if (!id || id === target.id) return;
    if (zone === "inside") {
      setExpanded((s) => new Set(s).add(target.id));
      return void run(() => api.move(id, target.id));
    }
    const siblings = (children.get(target.parentNodeId) ?? []).map((n) => n.id).filter((x) => x !== id);
    const at = siblings.indexOf(target.id) + (zone === "after" ? 1 : 0);
    siblings.splice(at, 0, id);
    void run(() => api.reorder(target.parentNodeId, siblings));
  }

  const dropHandlers = (kind: "shadow" | "root") => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      setDropTarget(kind);
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (id) void run(() => api.move(id, kind === "shadow" ? SHADOW : null));
    },
  });

  function renderRow(n: NodeMeta, depth: number, inTree: boolean) {
    const kids = children.get(n.id) ?? [];
    const open = expanded.has(n.id) || ancestors.has(n.id);
    const cls = ["tree-row", selectedId === n.id ? "selected" : "", inTree && drop?.id === n.id ? `drop-${drop.zone}` : ""].join(" ");
    return (
      <div key={`${inTree ? "t" : "f"}-${n.id}`}>
        <div
          className={cls}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => props.onNavigate({ kind: "node", id: n.id })}
          draggable={inTree}
          onDragStart={(e) => onDragStart(e, n)}
          onDragOver={
            inTree
              ? (e) => {
                  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                  e.preventDefault();
                  const zone = zoneFor(e);
                  if (drop?.id !== n.id || drop.zone !== zone) setDrop({ id: n.id, zone });
                }
              : undefined
          }
          onDragLeave={inTree ? () => setDrop((d) => (d?.id === n.id ? null : d)) : undefined}
          onDrop={inTree ? (e) => onRowDrop(e, n) : undefined}
        >
          <button
            className="twisty"
            aria-label={open ? t("sidebar.collapse") : t("sidebar.expand")}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((s) => {
                const next = new Set(s);
                if (open) next.delete(n.id);
                else next.add(n.id);
                return next;
              });
            }}
          >
            {inTree && kids.length ? (open ? "▾" : "▸") : ""}
          </button>
          <span className="tree-icon">{n.icon ?? (n.database ? "▦" : n.archeId === n.id ? "◈" : "◇")}</span>
          <span className="tree-title">{n.title}</span>
          {inTree && (
            <span className="row-actions">
              <button
                title={t("sidebar.addChild")}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((s) => new Set(s).add(n.id));
                  props.onCreate(n.id);
                }}
              >
                +
              </button>
              <button
                title={t("common.moveToTrash")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onTrash(n);
                }}
              >
                🗑
              </button>
            </span>
          )}
        </div>
        {inTree && open && kids.map((k) => renderRow(k, depth + 1, true))}
      </div>
    );
  }

  const arches = children.get(null) ?? [];

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/logo.png" alt="" />
        <div>
          <strong>Nularche</strong>
          <small title={props.originName}>Origin · {props.originName}</small>
        </div>
      </div>
      <button className="side-btn" onClick={props.onOpenSearch}>
        ⌕ {t("sidebar.search")} <kbd>{keys("Mod+K")}</kbd>
      </button>
      <button
        className={`side-btn ${route.kind === "shadow" ? "active" : ""} ${dropTarget === "shadow" ? "drop-target" : ""}`}
        onClick={() => props.onNavigate({ kind: "shadow" })}
        title={t("sidebar.shadowHint")}
        {...dropHandlers("shadow")}
      >
        ◐ Shadow {props.shadowCount > 0 && <span className="badge">{props.shadowCount}</span>}
      </button>
      <button className="side-btn" onClick={() => props.onCreate(SHADOW)}>
        ＋ {t("common.quickNote")} <kbd>{keys("Mod+N")}</kbd>
      </button>
      <button className="side-btn" onClick={props.onDaily}>
        📅 {t("daily.today")} <kbd>{keys("Mod+Shift+D")}</kbd>
      </button>
      <button className="side-btn" onClick={props.onOpenTemplates}>
        📋 {t("tpl.title")}
      </button>

      {favorites.length > 0 && (
        <div className="side-section">
          <div className="side-section-head">{t("sidebar.favorites")}</div>
          {favorites.map((n) => renderRow(n, 0, false))}
        </div>
      )}

      <div className="side-section tree">
        <div className={`side-section-head ${dropTarget === "root" ? "drop-target" : ""}`} {...dropHandlers("root")}>
          <span>{t("sidebar.arches")}</span>
          <button title={t("common.newArche")} onClick={() => props.onCreate(null)}>
            +
          </button>
        </div>
        {arches.map((n) => renderRow(n, 0, true))}
        {arches.length === 0 && <p className="empty">{t("sidebar.noArches")}</p>}
      </div>

      {templates.length > 0 && (
        <div className="side-section">
          <div className="side-section-head">{t("tpl.mine")}</div>
          {templates.map((n) => renderRow(n, 0, false))}
        </div>
      )}

      <div className="sidebar-foot">
        <button
          className={`side-btn ${route.kind === "trash" ? "active" : ""}`}
          onClick={() => props.onNavigate({ kind: "trash" })}
          title={t("trash.title")}
        >
          🗑 {t("trash.title")} {props.trashCount > 0 && <span className="badge">{props.trashCount}</span>}
        </button>
        <button className="side-btn" onClick={props.onOpenSettings}>
          ⚙ {t("settings.title")}
        </button>
      </div>
    </aside>
  );
}
