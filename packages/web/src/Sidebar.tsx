// Kenar çubuğu: Origin başlığı, Shadow, favoriler ve Arche ağacı.
// Node'lar sürüklenerek başka bir Node'un altına, kardeşlerin arasına, köke (Arche) ya da Shadow'a bırakılabilir.
// Arche'ler Archipelago'larda gruplanabilir (yalnızca görünüm; bkz. notes/archipelago.ts).

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { api, SHADOW, type NodeMeta, type ParentTarget, type TagCount } from "./api.ts";
import type { SmartFolder } from "./notes/smart.ts";
import { getPref, usePref } from "./prefs.ts";
import { askText } from "./ask.tsx";
import { assignArche, groupOf, newArchipelagoId, resolveArchipelagos, type Archipelago } from "./notes/archipelago.ts";
import type { Route } from "./App.tsx";
import { t } from "./i18n/index.ts";
import { keys } from "./shortcuts.tsx";
import { runCommand } from "./commands.ts";
import { NewProjectMenu, termTip, useDismiss } from "./studio/StudioTools.tsx";
import { SidebarToggle } from "./SidebarToggle.tsx";
import { peekEnter, peekLeave, usePeek } from "./sidebarPeek.ts";
import { Icon } from "./ui/Icon.tsx";
import { nodeIconName } from "./ui/node-icon.ts";
import { addContextItems } from "./contextMenu.ts";
import { desktop } from "./desktop.ts";

const DRAG_TYPE = "application/x-nularche-node";

type DropZone = "before" | "inside" | "after";

export interface SidebarProps {
  nodes: NodeMeta[];
  route: Route;
  originName: string;
  shadowCount: number;
  trashCount: number;
  onNavigate: (route: Route) => void;
  /** Yeni Node oluşturur; oluşturulan Node'un kimliğini döndürebilir. */
  onCreate: (parent: ParentTarget) => void | Promise<string | void>;
  onTrash: (node: NodeMeta) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenTemplates: () => void;
  onDaily: () => void;
  tags: TagCount[];
  smartFolders: SmartFolder[];
  recentCount: number;
  /** Akıllı klasör düzenle (yeni için undefined). */
  onEditSmart: (folder?: SmartFolder) => void;
  onRenameTag: (tag: string) => void;
  onConvertToSmart: (arche: NodeMeta) => void;
}

export function Sidebar(props: SidebarProps) {
  const { nodes, route } = props;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);
  const [dropTarget, setDropTarget] = useState<"shadow" | "root" | null>(null);
  const [collapsed, setCollapsed] = usePref<Record<string, boolean>>("sidebarCollapsed", {});
  const [projectMenu, setProjectMenu] = useState<DOMRect | null>(null);
  const [groups, setGroups] = usePref<Archipelago[]>("archipelagos", []);
  const [archMenu, setArchMenu] = useState<{ arche: NodeMeta; anchor: DOMRect } | null>(null);
  const [groupDrop, setGroupDrop] = useState<string | null>(null);
  // Gizli kenar çubuğu yerinde yer kaplamaz; küçültme düğmesinin üzerine gelince açılır panel olarak belirir.
  const [hidden] = usePref<boolean>("sidebarMini", false);
  const peek = usePeek();
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hidden && !peek) {
      setProjectMenu(null);
      setArchMenu(null);
    }
  }, [hidden, peek]);
  // Menü (seçimle ya da dışarı tıklanınca) kapandığında fare panelde değilse panel de kapanır: menü kalkınca
  // tarayıcı "fare ayrıldı" olayı göndermez.
  useEffect(() => {
    if (hidden && !projectMenu && !archMenu && !asideRef.current?.matches(":hover")) peekLeave();
  }, [hidden, projectMenu, archMenu]);
  const toggleSection = (k: string) => setCollapsed({ ...collapsed, [k]: !collapsed[k] });

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

  const isArche = (n: NodeMeta | undefined) => !!n && n.parentNodeId === null && n.archeId === n.id;
  // Tercih, sorulan pencereler ve sunucu çağrıları sırasında değişebilir; her değişiklik en güncel listeye uygulanır.
  const saveGroups = (fn: (g: Archipelago[]) => Archipelago[]) => setGroups(fn(getPref<Archipelago[]>("archipelagos", [])));

  async function newGroup(withArche?: string) {
    const name = (await askText(t("arch.newPrompt"), "", t("arch.placeholder")))?.trim();
    if (!name) return;
    const g: Archipelago = { id: newArchipelagoId(), name, archeIds: [] };
    saveGroups((gs) => (withArche ? assignArche([...gs, g], withArche, g.id) : [...gs, g]));
  }

  async function renameGroup(g: Archipelago) {
    const name = (await askText(t("arch.renamePrompt"), g.name))?.trim();
    if (name && name !== g.name) saveGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, name } : x)));
  }

  /** Node'u bir Archipelago'ya (null: gruptan çıkar) koyar; Arche değilse önce köke taşınıp Arche olur. */
  async function placeInGroup(id: string, groupId: string | null, near?: { id: string; after: boolean }) {
    if (!isArche(nodes.find((n) => n.id === id))) {
      try {
        await api.move(id, null);
      } catch (err) {
        props.onError((err as Error).message);
        return props.onChanged();
      }
    }
    saveGroups((gs) => assignArche(gs, id, groupId, near));
    props.onChanged();
  }

  async function newArcheIn(groupId: string) {
    const id = await props.onCreate(null);
    if (typeof id === "string") saveGroups((gs) => assignArche(gs, id, groupId));
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
    // Bir Archipelago'daki Arche'nin önüne/arkasına bırakılan Node o gruba, o sıraya girer.
    const group = isArche(target) ? groupOf(groups, target.id) : undefined;
    if (group) return void placeInGroup(id, group.id, { id: target.id, after: zone === "after" });
    if (isArche(target)) saveGroups((gs) => assignArche(gs, id, null));
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
      if (!id) return;
      saveGroups((gs) => assignArche(gs, id, null));
      void run(() => api.move(id, kind === "shadow" ? SHADOW : null));
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
          onContextMenu={() => {
            const g = groupOf(groups, n.id);
            addContextItems([
              { label: t("db.open"), run: () => props.onNavigate({ kind: "node", id: n.id }) },
              ...(desktop?.openWindow ? [{ label: t("cmd.openWindow"), run: () => void desktop!.openWindow!(n.id) }] : []),
              { label: t("sidebar.addChild"), run: () => (setExpanded((s) => new Set(s).add(n.id)), void props.onCreate(n.id)) },
              ...(isArche(n)
                ? [
                    {
                      label: t("arch.moveTo"),
                      submenu: [
                        ...groups.map((x) => ({ label: x.name, checked: x.id === g?.id, run: () => void placeInGroup(n.id, x.id) })),
                        { label: t("arch.new"), run: () => void newGroup(n.id) },
                        ...(g ? [{ label: t("arch.leave"), run: () => void placeInGroup(n.id, null) }] : []),
                      ],
                    },
                  ]
                : []),
              "separator" as const,
              { label: t("common.moveToTrash"), run: () => props.onTrash(n) },
            ]);
          }}
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
            {inTree && kids.length ? <Icon name={open ? "chevron-down" : "chevron-right"} size={13} /> : null}
          </button>
          <span className="tree-icon">{n.icon ?? <Icon name={nodeIconName(n)} size={15} />}</span>
          <span className="tree-title">{n.title}</span>
          {inTree && (
            <span className="row-actions">
              {isArche(n) && (
                <button
                  data-menu-trigger
                  title={t("arch.moveTo")}
                  onClick={(e) => {
                    e.stopPropagation();
                    const anchor = e.currentTarget.getBoundingClientRect();
                    setArchMenu((m) => (m?.arche.id === n.id ? null : { arche: n, anchor }));
                  }}
                >
                  <Icon name="stack-2" size={14} />
                </button>
              )}
              <button
                title={t("list.openList")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onNavigate({ kind: "list", id: n.id });
                }}
              >
                <Icon name="list" size={14} />
              </button>
              <button
                title={t("sidebar.addChild")}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((s) => new Set(s).add(n.id));
                  props.onCreate(n.id);
                }}
              >
                <Icon name="plus" size={14} />
              </button>
              <button
                title={t("common.moveToTrash")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onTrash(n);
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          )}
        </div>
        {inTree && open && kids.map((k) => renderRow(k, depth + 1, true))}
      </div>
    );
  }

  const arches = children.get(null) ?? [];
  const archipelagos = resolveArchipelagos(groups, arches);

  function renderGroup({ group: g, arches: members }: (typeof archipelagos.groups)[number]) {
    const closed = !!collapsed[`arch:${g.id}`];
    return (
      <div key={`g-${g.id}`} className="arch-group">
        <div
          className={`tree-row arch-row ${groupDrop === g.id ? "drop-inside" : ""}`}
          style={{ paddingLeft: 6 }}
          onClick={() => toggleSection(`arch:${g.id}`)}
          title={termTip("Archipelago", "gloss.archipelago")}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            if (groupDrop !== g.id) setGroupDrop(g.id);
          }}
          onDragLeave={() => setGroupDrop((d) => (d === g.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            setGroupDrop(null);
            const id = e.dataTransfer.getData(DRAG_TYPE);
            if (id) void placeInGroup(id, g.id);
          }}
        >
          <span className="twisty" aria-hidden>
            <Icon name={closed ? "chevron-right" : "chevron-down"} size={13} />
          </span>
          <span className="tree-icon">{g.icon ?? <Icon name="stack-2" size={15} />}</span>
          <span className="tree-title">{g.name}</span>
          <span className="arch-count" title={t("arch.count", { n: members.length })}>
            {members.length}
          </span>
          <span className="row-actions">
            <button
              title={t("arch.newArche")}
              onClick={(e) => {
                e.stopPropagation();
                void newArcheIn(g.id);
              }}
            >
              <Icon name="plus" size={14} />
            </button>
            <button
              title={t("arch.rename")}
              onClick={(e) => {
                e.stopPropagation();
                void renameGroup(g);
              }}
            >
              <Icon name="pencil" size={14} />
            </button>
            <button
              title={t("arch.remove")}
              onClick={(e) => {
                e.stopPropagation();
                saveGroups((gs) => gs.filter((x) => x.id !== g.id));
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </span>
        </div>
        {!closed && members.map((a) => renderRow(a, 1, true))}
        {!closed && !members.length && <p className="empty arch-empty">{t("arch.empty")}</p>}
      </div>
    );
  }

  return (
    <aside
      ref={asideRef}
      className={`sidebar ${hidden ? `peek ${peek ? "open" : ""}` : ""}`}
      aria-hidden={hidden && !peek ? true : undefined}
      onMouseEnter={hidden ? peekEnter : undefined}
      onMouseLeave={hidden ? peekLeave : undefined}
    >
      <div className="brand">
        <img src="/logo.png" alt="" />
        <div>
          <strong>Nularche</strong>
          <small title={props.originName}>Origin · {props.originName}</small>
        </div>
        {!hidden && <SidebarToggle />}
      </div>
      <button className={`side-btn ${route.kind === "home" ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "home" })} title={termTip("Atrium", "gloss.atrium")}>
        <Icon name="building-bank" /> Atrium
      </button>
      <button className="side-btn" onClick={props.onOpenSearch}>
        <Icon name="search" /> {t("sidebar.search")} <kbd>{keys("Mod+K")}</kbd>
      </button>
      <button
        className={`side-btn ${route.kind === "shadow" ? "active" : ""} ${dropTarget === "shadow" ? "drop-target" : ""}`}
        onClick={() => props.onNavigate({ kind: "shadow" })}
        title={t("sidebar.shadowHint")}
        {...dropHandlers("shadow")}
      >
        <Icon name="circle-half-2" /> Shadow {props.shadowCount > 0 && <span className="badge">{props.shadowCount}</span>}
      </button>
      <button className="side-btn" onClick={() => props.onCreate(SHADOW)}>
        <Icon name="plus" /> {t("common.quickNote")} <kbd>{keys("Mod+N")}</kbd>
      </button>
      <button className="side-btn" onClick={props.onDaily}>
        <Icon name="calendar-event" /> {t("daily.today")} <kbd>{keys("Mod+Shift+D")}</kbd>
      </button>
      <button className="side-btn" onClick={props.onOpenTemplates}>
        <Icon name="template" /> {t("tpl.title")}
      </button>
      <div className="rel">
        <button data-menu-trigger className={`side-btn ${projectMenu ? "active" : ""}`} onClick={(e) => setProjectMenu(projectMenu ? null : e.currentTarget.getBoundingClientRect())} title={t("ws.newProjectHint")}>
          <Icon name="sparkles" /> {t("ws.newProject")} <span className="side-caret"><Icon name="chevron-right" size={13} /></span>
        </button>
        {projectMenu && <NewProjectMenu anchor={projectMenu} onClose={() => setProjectMenu(null)} onMouseEnter={hidden ? peekEnter : undefined} onMouseLeave={hidden ? peekLeave : undefined} />}
      </div>
      <button className={`side-btn ${route.kind === "notes" ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "notes" })}>
        <Icon name="notes" /> {t("list.allNotes")}
      </button>
      <button className={`side-btn ${route.kind === "recent" ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "recent" })}>
        <Icon name="clock" /> {t("list.recent")} {props.recentCount > 0 && <span className="badge">{Math.min(props.recentCount, 30)}</span>}
      </button>
      <button className={`side-btn ${route.kind === "attachments" ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "attachments" })}>
        <Icon name="paperclip" /> {t("att.title")}
      </button>

      <div className="side-section">
        <div className="side-section-head">
          <span className="clickable" onClick={() => toggleSection("smart")}>
            <Icon name={collapsed.smart ? "chevron-right" : "chevron-down"} size={12} /> {t("smart.title")}
          </span>
          <button title={t("smart.new")} onClick={() => props.onEditSmart()}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {!collapsed.smart &&
          props.smartFolders.map((f) => (
            <div
              key={f.id}
              className={`tree-row ${route.kind === "smart" && route.id === f.id ? "selected" : ""}`}
              style={{ paddingLeft: 6 }}
              onClick={() => props.onNavigate({ kind: "smart", id: f.id })}
            >
              <span className="twisty" />
              <span className="tree-icon">{f.icon ?? <Icon name="folder-cog" size={15} />}</span>
              <span className="tree-title">{f.name}</span>
              <span className="row-actions">
                <button
                  title={t("smart.edit")}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onEditSmart(f);
                  }}
                >
                  <Icon name="pencil" size={14} />
                </button>
              </span>
            </div>
          ))}
      </div>

      {props.tags.length > 0 && (
        <div className="side-section">
          <div className="side-section-head">
            <span className="clickable" onClick={() => toggleSection("tags")}>
              <Icon name={collapsed.tags ? "chevron-right" : "chevron-down"} size={12} /> {t("tags.title")}
            </span>
          </div>
          {!collapsed.tags && (
            <div className="side-tags">
              {props.tags.map((tg) => (
                <button
                  key={tg.tag}
                  className={`tag-chip ${route.kind === "tag" && route.tag.toLocaleLowerCase("tr") === tg.tag.toLocaleLowerCase("tr") ? "on" : ""}`}
                  onClick={() => props.onNavigate({ kind: "tag", tag: tg.tag })}
                  onDoubleClick={() => props.onRenameTag(tg.tag)}
                  title={`${tg.count} · ${t("tags.rename")}: ↵↵`}
                >
                  #{tg.tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {favorites.length > 0 && (
        <div className="side-section">
          <div className="side-section-head">{t("sidebar.favorites")}</div>
          {favorites.map((n) => renderRow(n, 0, false))}
        </div>
      )}

      <div className="side-section tree">
        <div className={`side-section-head ${dropTarget === "root" ? "drop-target" : ""}`} {...dropHandlers("root")}>
          <span>{t("sidebar.arches")}</span>
          <span className="side-head-btns">
            <button title={termTip(t("arch.new"), "gloss.archipelago")} onClick={() => void newGroup()}>
              <Icon name="stack-2" size={14} />
            </button>
            <button title={t("common.newArche")} onClick={() => props.onCreate(null)}>
              <Icon name="plus" size={14} />
            </button>
          </span>
        </div>
        {archipelagos.groups.map(renderGroup)}
        {archipelagos.loose.map((n) => renderRow(n, 0, true))}
        {arches.length === 0 && <p className="empty">{t("sidebar.noArches")}</p>}
      </div>

      {templates.length > 0 && (
        <div className="side-section">
          <div className="side-section-head">{t("tpl.mine")}</div>
          {templates.map((n) => renderRow(n, 0, false))}
        </div>
      )}

      {archMenu && (
        <ArchipelagoMenu
          arche={archMenu.arche}
          anchor={archMenu.anchor}
          groups={groups}
          onClose={() => setArchMenu(null)}
          onPick={(groupId) => void placeInGroup(archMenu.arche.id, groupId)}
          onNew={() => void newGroup(archMenu.arche.id)}
          onMouseEnter={hidden ? peekEnter : undefined}
          onMouseLeave={hidden ? peekLeave : undefined}
        />
      )}

      <div className="sidebar-foot">
        <button
          className={`side-btn ${route.kind === "trash" ? "active" : ""}`}
          onClick={() => props.onNavigate({ kind: "trash" })}
          title={t("trash.title")}
        >
          <Icon name="trash" /> {t("trash.title")} {props.trashCount > 0 && <span className="badge">{props.trashCount}</span>}
        </button>
        <button className="side-btn" onClick={() => runCommand("help.glossary")} title={t("gloss.intro")}>
          <Icon name="info-circle" /> {t("gloss.title")}
        </button>
        <button className="side-btn" onClick={props.onOpenSettings}>
          <Icon name="settings" /> {t("settings.title")}
        </button>
      </div>
    </aside>
  );
}

/** Bir Arche'nin Archipelago'sunu seçme menüsü; kenar çubuğu kırpmasın diye belgenin üst katmanında açılır. */
function ArchipelagoMenu(p: {
  arche: NodeMeta;
  anchor: DOMRect;
  groups: Archipelago[];
  onClose: () => void;
  onPick: (groupId: string | null) => void;
  onNew: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, p.onClose);
  const current = groupOf(p.groups, p.arche.id)?.id ?? null;
  const top = Math.max(8, Math.min(p.anchor.top, window.innerHeight - 60 - 34 * (p.groups.length + 2)));
  const pick = (fn: () => void) => () => {
    p.onClose();
    fn();
  };
  return createPortal(
    <div className="menu-pop arch-menu" ref={ref} role="menu" style={{ position: "fixed", left: p.anchor.right + 6, top, right: "auto" }} onMouseEnter={p.onMouseEnter} onMouseLeave={p.onMouseLeave}>
      <div className="menu-title">
        {t("arch.moveTo")} · {p.arche.title}
      </div>
      {p.groups.map((g) => (
        <button key={g.id} role="menuitemradio" aria-checked={g.id === current} className={g.id === current ? "on" : ""} onClick={pick(() => p.onPick(g.id))}>
          <span className="arch-check">{g.id === current ? <Icon name="check" size={14} /> : null}</span> {g.icon ?? <Icon name="stack-2" size={15} />} {g.name}
        </button>
      ))}
      {p.groups.length > 0 && <hr />}
      <button role="menuitem" onClick={pick(p.onNew)}>
        <span className="arch-check"><Icon name="plus" size={14} /></span> {t("arch.new")}
      </button>
      {current && (
        <button role="menuitem" onClick={pick(() => p.onPick(null))}>
          <span className="arch-check"><Icon name="arrow-back-up" size={14} /></span> {t("arch.leave")}
        </button>
      )}
    </div>,
    document.body,
  );
}
