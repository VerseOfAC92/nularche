import { useCallback, useEffect, useRef, useState } from "react";
import { AskHost, askText } from "./ask.tsx";
import { api, SHADOW, type NodeMeta, type ParentTarget } from "./api.ts";
import { desktop } from "./desktop.ts";
import { NodeView } from "./NodeView.tsx";
import { SearchDialog } from "./SearchDialog.tsx";
import { Settings } from "./Settings.tsx";
import { ShadowView } from "./ShadowView.tsx";
import { TrashView } from "./TrashView.tsx";
import { ShortcutsDialog } from "./shortcuts.tsx";
import { TemplateGallery } from "./templates/TemplateGallery.tsx";
import { BUILTIN_TEMPLATES } from "./templates/builtins.ts";
import { todayIso } from "./database/model.ts";
import { Sidebar } from "./Sidebar.tsx";
import { NularcheAI, type AiContext } from "./ai/NularcheAI.tsx";
import { Onboarding } from "./ai/Onboarding.tsx";
import { PROVIDER_LABEL } from "./ai/prompts.ts";
import { t, getLang, useLang } from "./i18n/index.ts";
import { handleShortcut, menuSpec, registerCommand, runCommand, setHotkeyOverrides } from "./commands.ts";
import { CommandPalette, QuickSwitcher } from "./vault/Palettes.tsx";
import { GraphView } from "./vault/GraphView.tsx";
import { SidePanel, type PanelTab } from "./vault/SidePanel.tsx";
import { isExcluded } from "./vault/excluded.ts";
import { PagePreview } from "./vault/PagePreview.tsx";
import { EMPTY_TABS, TabBar, type TabState } from "./vault/Tabs.tsx";
import { Picker } from "./vault/Picker.tsx";
import { getPref, loadPrefs, setPref, usePref } from "./prefs.ts";
import { NoteList } from "./notes/NoteList.tsx";
import { AttachmentBrowser } from "./notes/AttachmentBrowser.tsx";
import { SmartFolderDialog } from "./notes/SmartFolderDialog.tsx";
import { smartMatches, type SmartFolder } from "./notes/smart.ts";
import { FocusHud } from "./focus/FocusHud.tsx";
import { backgroundStyle, type WritingBg } from "./focus/scenes.ts";
import { fileUrl } from "./editor/paths.ts";
import type { TagCount } from "./api.ts";

export type Route =
  | { kind: "home" }
  | { kind: "shadow" }
  | { kind: "trash" }
  | { kind: "node"; id: string }
  | { kind: "notes" }
  | { kind: "recent" }
  | { kind: "attachments" }
  | { kind: "graph" }
  | { kind: "tag"; tag: string }
  | { kind: "smart"; id: string }
  | { kind: "list"; id: string };

function parseHash(): Route {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return { kind: "home" };
  if (h === "shadow" || h === "trash" || h === "notes" || h === "recent" || h === "attachments" || h === "graph") return { kind: h };
  const m = /^(tag|smart|list):(.+)$/.exec(h);
  if (m) return m[1] === "tag" ? { kind: "tag", tag: m[2] } : { kind: m[1] as "smart" | "list", id: m[2] };
  return { kind: "node", id: h };
}

function routeHash(r: Route): string {
  switch (r.kind) {
    case "home":
      return "";
    case "node":
      return encodeURIComponent(r.id);
    case "tag":
      return `tag:${encodeURIComponent(r.tag)}`;
    case "smart":
    case "list":
      return `${r.kind}:${encodeURIComponent(r.id)}`;
    default:
      return r.kind;
  }
}

/** Ayrı not penceresi (`?window=single`): yalnızca not görünümü. */
const SINGLE = new URLSearchParams(location.search).get("window") === "single";

/** Tarayıcıda dosya/klasör seçtirip içerikleri base64 olarak okur. */
function pickFilesForImport(folder: boolean): Promise<{ path: string; data: string }[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (folder) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    else input.accept = ".md,.markdown,.txt,.html,.htm,.rtf";
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return resolve(null);
      const out: { path: string; data: string }[] = [];
      for (const f of files) {
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        out.push({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, data: btoa(bin) });
      }
      resolve(out);
    };
    input.click();
  });
}

/** Bir Node'un tüm alt Node'larının id'leri (üst bağlantısından; dosya yoluna göre değil). */
function descendantIds(nodes: NodeMeta[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const n of nodes) if (n.parentNodeId === pid && !out.has(n.id)) (out.add(n.id), walk(n.id));
  };
  walk(id);
  return out;
}

export function App() {
  const [nodes, setNodes] = useState<NodeMeta[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [route, setRoute] = useState<Route>(parseHash);
  const [originName, setOriginName] = useState("");
  const [changeTick, setChangeTick] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const [aiOpen, setAiOpenState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("nlc-ai-open") === "1";
    } catch {
      return false;
    }
  });
  const setAiOpen = useCallback((v: boolean) => {
    setAiOpenState(v);
    try {
      localStorage.setItem("nlc-ai-open", v ? "1" : "0");
    } catch {
      // yalnızca bu oturum
    }
  }, []);
  const [aiContext, setAiContext] = useState<AiContext>({});
  const [aiTick, setAiTick] = useState(0);
  const [onboarding, setOnboarding] = useState(false);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [focus, setFocus] = useState(false);
  const [smartEdit, setSmartEdit] = useState<Partial<SmartFolder> | null>(null);
  const [smartFolders, setSmartFolders] = usePref<SmartFolder[]>("smartFolders", []);
  const [recent] = usePref<string[]>("recent", []);
  const [writingBg] = usePref<WritingBg>("writingBg", { kind: "none" });
  const [bgEverywhere] = usePref<boolean>("writingBgEverywhere", false);
  const [focusWidth] = usePref<number>("focusWidth", 720);
  const [fixedWidth] = usePref<boolean>("focusFixedWidth", false);
  const [focusDim] = usePref<boolean>("focusDim", false);
  const [typewriter] = usePref<boolean>("focusTypewriter", false);
  const [spellcheck] = usePref<boolean>("spellcheck", true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [panel, setPanel] = usePref<PanelTab | null>("sidePanel", null);
  const [hotkeys] = usePref<Record<string, string>>("hotkeys", {});
  const [enabledSnippets] = usePref<string[]>("enabledSnippets", []);
  const [snippets, setSnippets] = useState<{ name: string; css: string }[]>([]);
  const [accent] = usePref<string>("accentColor", "");
  const [readable] = usePref<boolean>("readableLineLength", false);
  const [newNoteLocation] = usePref<"shadow" | "current">("newNoteLocation", "shadow");
  const [excluded] = usePref<string[]>("excludedFiles", []);
  const [tabsPref, setTabs] = usePref<TabState>("tabs", EMPTY_TABS);
  const tabs: TabState = Array.isArray(tabsPref?.hashes) && tabsPref.hashes.length ? { hashes: tabsPref.hashes, active: Math.min(Math.max(0, tabsPref.active | 0), tabsPref.hashes.length - 1) } : EMPTY_TABS;
  const [workspaces, setWorkspaces] = usePref<Record<string, TabState>>("workspaces", {});
  const [workspacePick, setWorkspacePick] = useState(false);
  const lang = useLang();
  setHotkeyOverrides(hotkeys);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const navigate = useCallback((r: Route) => {
    location.hash = routeHash(r);
    setRoute(r);
  }, []);

  // Gezinme etkin sekmenin adresini değiştirir.
  const currentHash = routeHash(route);
  useEffect(() => {
    if (SINGLE || tabs.hashes[tabs.active] === currentHash) return;
    setTabs({ hashes: tabs.hashes.map((h, i) => (i === tabs.active ? currentHash : h)), active: tabs.active });
  }, [currentHash]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectTab = (i: number, state: TabState = tabs) => {
    setTabs({ ...state, active: i });
    location.hash = state.hashes[i] ?? "";
    setRoute(parseHash());
  };
  const openInTab = (hash: string) => selectTab(tabs.hashes.length, { hashes: [...tabs.hashes, hash], active: tabs.active });
  const closeTab = (i: number) => {
    if (tabs.hashes.length < 2) return;
    const hashes = tabs.hashes.filter((_, j) => j !== i);
    const active = i < tabs.active ? tabs.active - 1 : Math.min(tabs.active, hashes.length - 1);
    selectTab(active, { hashes, active });
  };

  const refresh = useCallback(async () => {
    try {
      setNodes(await api.list());
      api.trashList().then((e) => setTrashCount(e.length), () => undefined);
      api.tags().then(setTags, () => undefined);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    // Açılışta gösterilecek görünüm (Obsidian "Default file to open"): son açık sekme, günlük not ya da ana sayfa.
    void loadPrefs().then(() => {
      if (location.hash || SINGLE) return;
      const startup = getPref<"last" | "daily" | "home">("startupView", "last");
      const saved = getPref<TabState>("tabs", EMPTY_TABS);
      if (startup === "daily") runCommand("daily.today");
      else if (startup === "last" && Array.isArray(saved.hashes) && saved.hashes[saved.active]) location.hash = saved.hashes[saved.active];
    });
    refresh();
    api.origin().then(
      (o) => setOriginName(o.name),
      () => undefined,
    );
    desktop?.checkUpdate().then(setUpdate);
    const onHash = () => setRoute(parseHash());
    addEventListener("hashchange", onHash);
    const off = desktop?.onNavigate((id) => {
      refresh();
      navigate({ kind: "node", id });
    });
    desktop?.rendererReady().then((id) => id && (refresh(), navigate({ kind: "node", id })));
    desktop?.aiStatus().then((s) => !s.onboarded && setOnboarding(true));
    const offAi = desktop?.onAiConnected((c) => {
      setAiTick((t) => t + 1);
      showToast(t("app.aiConnected", { name: c.provider ? PROVIDER_LABEL[c.provider] : c.name }));
    });
    return () => {
      removeEventListener("hashchange", onHash);
      off?.();
      offAi?.();
    };
  }, [refresh, navigate]);

  // Origin dışarıdan (ör. Claude MCP ile) değişince listeyi ve açık görünümü yenile.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("change", () => {
      refresh();
      setChangeTick((t) => t + 1);
    });
    es.addEventListener("ai", () => setAiTick((t) => t + 1));
    return () => es.close();
  }, [refresh]);

  // CSS parçacıkları (Ayarlar → Görünüm) ve vurgu rengi.
  useEffect(() => {
    api.snippets().then(setSnippets, () => setSnippets([]));
  }, [changeTick]);
  useEffect(() => {
    const root = document.documentElement.style;
    if (!accent) for (const v of ["--nlc-accent-primary", "--nlc-accent-glow"]) root.removeProperty(v);
    else {
      root.setProperty("--nlc-accent-primary", accent);
      root.setProperty("--nlc-accent-glow", `color-mix(in srgb, ${accent} 16%, transparent)`);
    }
  }, [accent]);

  const create = useCallback(
    async (parent: ParentTarget) => {
      try {
        const n = await api.create(t("common.untitled"), parent);
        await refresh();
        navigate({ kind: "node", id: n.id });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, navigate],
  );

  /** Günlük not: "Günlük" Arche'si altında bugünün tarihli sayfasını açar, yoksa günlük şablonuyla oluşturur. */
  const openDaily = useCallback(async () => {
    try {
      const names = ["Günlük", "Journal"];
      let arche = nodes.find((n) => n.archeId === n.id && names.includes(n.title));
      if (!arche) arche = await api.create(t("daily.arche"), null, "", { icon: "📔" });
      const today = todayIso();
      let page = nodes.find((n) => n.parentNodeId === arche!.id && n.title === today);
      if (!page) {
        const tpl = BUILTIN_TEMPLATES.find((x) => x.key === "daily")!;
        page = await api.create(today, arche.id, tpl.body?.[getLang()] ?? "");
      }
      await refresh();
      navigate({ kind: "node", id: page.id });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [nodes, refresh, navigate]);

  /** Başlıkla not oluşturur (hızlı geçiş, var olmayan [[wiki]] hedefi). Yer: Shadow ya da açık notun yanı. */
  const createTitled = useCallback(
    async (title: string, extra?: { body?: string; fields?: Record<string, unknown> }) => {
      try {
        const cur = route.kind === "node" ? nodes.find((n) => n.id === route.id) : undefined;
        const parent: ParentTarget = newNoteLocation === "current" && cur ? (cur.parentNodeId ?? (cur.archeId === null ? SHADOW : null)) : SHADOW;
        const n = await api.create(title, parent, extra?.body, extra?.fields);
        await refresh();
        navigate({ kind: "node", id: n.id });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [route, nodes, newNoteLocation, refresh, navigate],
  );

  /** Önceki/sonraki günlük not: Günlük Arche'sindeki tarih başlıklı sayfalar arasında. */
  const stepDaily = useCallback(
    (dir: -1 | 1) => {
      const names = ["Günlük", "Journal"];
      const arche = nodes.find((n) => n.archeId === n.id && names.includes(n.title));
      const days = nodes.filter((n) => n.parentNodeId === arche?.id && /^\d{4}-\d{2}-\d{2}$/.test(n.title)).sort((a, b) => a.title.localeCompare(b.title));
      const cur = route.kind === "node" ? nodes.find((n) => n.id === route.id) : undefined;
      const ref = cur && days.includes(cur) ? cur.title : todayIso();
      const next = dir < 0 ? days.filter((d) => d.title < ref).pop() : days.find((d) => d.title > ref);
      if (next) navigate({ kind: "node", id: next.id });
      else showToast(t("ob.noDaily"));
    },
    [nodes, route, navigate, showToast],
  );

  const trash = useCallback(
    async (n: NodeMeta) => {
      const below = descendantIds(nodes, n.id);
      const subCount = below.size;
      const msg = subCount ? t("app.trashConfirmChildren", { title: n.title, count: subCount }) : t("app.trashConfirm", { title: n.title });
      if (!confirm(msg)) return;
      await api.trash(n.id);
      if (route.kind === "node") {
        const cur = nodes.find((x) => x.id === route.id);
        if (cur && (cur.id === n.id || below.has(cur.id))) navigate({ kind: "home" });
      }
      refresh();
      showToast(t("app.trashed"));
    },
    [nodes, route, navigate, refresh, showToast],
  );

  const openPath = useCallback(
    (p: string) => {
      const n = nodes.find((x) => x.path === p);
      if (n) navigate({ kind: "node", id: n.id });
      else showToast(t("app.linkNotFound", { path: p }));
    },
    [nodes, navigate, showToast],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handleShortcut(e);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [create, openDaily]);

  const importNotes = useCallback(
    async (folder: boolean) => {
      try {
        let res;
        if (desktop) res = await desktop.importNotes(folder ? "folder" : "files");
        else {
          const files = await pickFilesForImport(folder);
          res = files ? await api.importFiles(files) : null;
        }
        if (!res) return;
        await refresh();
        if (!res.created.length) return showToast(t("import.none"));
        showToast(t("import.done", { n: res.created.length, a: res.attachments }));
        navigate(res.created.length === 1 ? { kind: "node", id: res.created[0].id } : { kind: "shadow" });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, navigate, showToast],
  );

  const toggleFocus = useCallback((on?: boolean) => {
    setFocus((cur) => {
      const next = on ?? !cur;
      void desktop?.setFullScreen(next);
      return next;
    });
  }, []);

  // Uygulama düzeyindeki komutlar (menü ve kısayollar).
  useEffect(() => {
    const offs = [
      registerCommand("note.new", () => void create(SHADOW)),
      registerCommand("view.focus", () => toggleFocus()),
      registerCommand("view.allNotes", () => navigate({ kind: "notes" })),
      registerCommand("view.recent", () => navigate({ kind: "recent" })),
      registerCommand("view.attachments", () => navigate({ kind: "attachments" })),
      registerCommand("view.list", () => navigate({ kind: "notes" })),
      registerCommand("view.gallery", () => navigate({ kind: "notes" })),
      registerCommand("app.importMarkdown", () => void importNotes(false)),
      registerCommand("app.importNotes", () => void importNotes(true)),
      registerCommand("edit.spellcheck", () => setPref("spellcheck", !getPref("spellcheck", true))),
      registerCommand("speech.stop", () => speechSynthesis.cancel()),
      registerCommand("app.palette", () => setPaletteOpen(true)),
      registerCommand("app.switcher", () => setSwitcherOpen(true)),
      registerCommand("app.search", () => setSearchOpen(true)),
      registerCommand("app.settings", () => setSettingsOpen(true)),
      registerCommand("app.shortcuts", () => setShortcutsOpen((v) => !v)),
      registerCommand("nav.back", () => history.back()),
      registerCommand("nav.forward", () => history.forward()),
      registerCommand("view.graph", () => navigate({ kind: "graph" })),
      registerCommand("view.sidePanel", () => setPanel(getPref<PanelTab | null>("sidePanel", null) ? null : "outline")),
      registerCommand("view.outline", () => setPanel("outline")),
      registerCommand("view.links", () => setPanel("links")),
      registerCommand("view.localGraph", () => setPanel("graph")),
      registerCommand("view.history", () => setPanel("history")),
      registerCommand("tab.new", () => openInTab("")),
      registerCommand("tab.duplicate", () => openInTab(currentHash)),
      registerCommand("tab.close", () => closeTab(tabs.active)),
      registerCommand("workspace.save", async () => {
        const name = (await askText(t("ob.workspaceName")))?.trim();
        if (name) (setWorkspaces({ ...workspaces, [name]: tabs }), showToast(t("ob.workspaceSaved", { name })));
      }),
      registerCommand("workspace.load", () => setWorkspacePick(true)),
      registerCommand("daily.today", () => void openDaily()),
      registerCommand("daily.prev", () => stepDaily(-1)),
      registerCommand("daily.next", () => stepDaily(1)),
      registerCommand("note.random", () => {
        const pool = nodes.filter((n) => !n.template && !n.database && !isExcluded(n.path, excluded) && !(route.kind === "node" && n.id === route.id));
        if (pool.length) navigate({ kind: "node", id: pool[Math.floor(Math.random() * pool.length)].id });
      }),
      registerCommand("note.unique", () => {
        const d = new Date();
        const p = (x: number) => String(x).padStart(2, "0");
        void createTitled(`${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`);
      }),
      registerCommand("canvas.new", () => void createTitled(t("ob.untitledCanvas"), { body: '```json canvas\n{\n  "nodes": [],\n  "edges": []\n}\n```\n', fields: { layout: "canvas", icon: "🧩" } })),
    ];
    return () => offs.forEach((o) => o());
  }); // eslint-disable-line react-hooks/exhaustive-deps -- her çizimde güncel sekme ve rota durumuyla yeniden kaydedilir

  // Masaüstü menüsü: komutlar arayüzden gönderilir (dil değişince yeniden kurulur).
  useEffect(() => {
    void desktop?.setMenu(menuSpec(), { "edit.spellcheck": spellcheck, "view.focus": focus, "view.sidePanel": !!panel });
  }, [lang, spellcheck, focus, panel, hotkeys]);
  useEffect(() => desktop?.onCommand((id) => void runCommand(id)), []);
  useEffect(() => void desktop?.setSpellcheck(spellcheck), [spellcheck]);

  // Daktilo kaydırması: odak modunda yazılan satır ekranın ortasında kalır.
  useEffect(() => {
    if (!focus || !typewriter) return;
    const onSel = () => {
      const sel = getSelection();
      if (!sel?.rangeCount || !document.activeElement?.closest(".ProseMirror")) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const main = document.querySelector<HTMLElement>(".main");
      if (!main || !rect.height) return;
      const delta = rect.top + rect.height / 2 - main.getBoundingClientRect().top - main.clientHeight / 2;
      if (Math.abs(delta) > 24) main.scrollBy({ top: delta, behavior: "smooth" });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [focus, typewriter]);

  const saveSmart = (f: SmartFolder) => {
    setSmartFolders([...smartFolders.filter((x) => x.id !== f.id), f]);
    setSmartEdit(null);
    navigate({ kind: "smart", id: f.id });
  };

  /** Arche'yi akıllı klasöre dönüştürür: içindeki notlara #etiket eklenir ve o etiketle bir akıllı klasör kurulur. */
  const convertToSmart = useCallback(
    async (arche: NodeMeta) => {
      const tag = arche.title
        .normalize("NFC")
        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "arche";
      const notes = nodes.filter((n) => n.archeId === arche.id && !n.database && !n.locked);
      if (!confirm(t("smart.convertConfirm", { title: arche.title, n: notes.length, tag }))) return;
      for (const n of notes) {
        if (n.tags.some((x) => x.toLocaleLowerCase("tr") === tag.toLocaleLowerCase("tr"))) continue;
        const doc = await api.read(n.id);
        await api.update(n.id, { body: `${doc.body.replace(/\s*$/, "")}\n\n#${tag}\n`, baseRevision: doc.revision });
      }
      const f: SmartFolder = { id: `sf_${Date.now().toString(36)}`, name: arche.title, icon: arche.icon, match: "all", tags: [tag] };
      setSmartFolders([...getPref<SmartFolder[]>("smartFolders", []), f]);
      await refresh();
      showToast(t("smart.converted"));
      navigate({ kind: "smart", id: f.id });
    },
    [nodes, refresh, navigate, showToast, setSmartFolders],
  );

  const renameTag = async (tag: string) => {
    const next = (await askText(t("tags.renamePrompt", { tag }), tag))?.trim().replace(/^#/, "");
    if (!next || next === tag) return;
    try {
      const { changed } = await api.renameTag(tag, next);
      await refresh();
      showToast(t("tags.renamed", { n: changed }));
      navigate({ kind: "tag", tag: next });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const listable = nodes.filter((n) => !n.template && !n.database && !(n.parentNodeId && nodes.find((p) => p.id === n.parentNodeId)?.database));
  const openNode = (id: string) => navigate({ kind: "node", id });

  const shadowCount = nodes.filter((n) => n.archeId === null).length;
  const context = route.kind === "node" && aiContext.nodeId === route.id ? aiContext : {};

  const bg = backgroundStyle(writingBg, fileUrl);
  const bgOn = (focus || bgEverywhere) && writingBg.kind !== "none";
  const mainStyle = {
    ...(bgOn && bg.background ? { background: bg.background } : {}),
    ...(bgOn && bg.color ? { "--bg-text": bg.color } : {}),
    // Varsayılan olarak satırlar 1.0'daki gibi pencere genişliğine uyar; sabit genişlik isteğe bağlıdır.
    "--focus-width": fixedWidth ? `${focusWidth}px` : "100%",
  } as React.CSSProperties;
  const mainClass = ["main", bgOn ? `has-bg ${bg.glass ? "bg-glass" : "bg-flat"} ${bg.dark ? "bg-dark" : "bg-light"}` : ""].join(" ");

  if (SINGLE && route.kind === "node") {
    return (
      <div className={`app single-window ${focus ? "focus-mode" : ""}`}>
        <main className={mainClass} style={mainStyle}>
          <NodeView
            key={route.id}
            id={route.id}
            nodes={nodes}
            changeTick={changeTick}
            onNavigate={(id) => navigate({ kind: "node", id })}
            onOpenPath={openPath}
            onChanged={refresh}
            onTrash={trash}
            onToast={showToast}
            onGone={() => window.close()}
            onContext={setAiContext}
            onOpenAI={() => undefined}
            onCreateTitle={(title) => void createTitled(title)}
          />
        </main>
        {toast && <div className="toast">{toast}</div>}
        <AskHost />
      </div>
    );
  }

  return (
    <div className={`app ${focus ? "focus-mode" : ""} ${focus && focusDim ? "focus-dim" : ""} ${readable ? "readable" : ""} ${panel && !focus ? "with-panel" : ""}`}>
      {snippets
        .filter((x) => enabledSnippets.includes(x.name))
        .map((x) => (
          <style key={x.name} data-snippet={x.name}>
            {x.css}
          </style>
        ))}
      {focus && <FocusHud onExit={() => toggleFocus(false)} />}
      <Sidebar
        tags={tags}
        smartFolders={smartFolders}
        recentCount={recent.length}
        onEditSmart={(f) => setSmartEdit(f ?? {})}
        onRenameTag={renameTag}
        onConvertToSmart={convertToSmart}
        nodes={nodes}
        route={route}
        originName={originName}
        shadowCount={shadowCount}
        trashCount={trashCount}
        onNavigate={navigate}
        onCreate={create}
        onTrash={trash}
        onChanged={refresh}
        onError={setError}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onDaily={openDaily}
      />
      <main className={mainClass} style={mainStyle}>
        {!focus && <TabBar tabs={tabs} nodes={nodes} onSelect={(i) => selectTab(i)} onClose={closeTab} onNew={() => openInTab("")} />}
        {update && (
          <div className="banner">
            {t("app.updateReady", { version: update.version })}
            <button onClick={() => desktop?.openExternal(update.url)}>{t("common.download")}</button>
            <button onClick={() => (desktop?.skipUpdate(update.version), setUpdate(null))}>{t("app.skipVersion")}</button>
          </div>
        )}
        {error && (
          <div className="banner error" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {route.kind === "node" && (
          <NodeView
            key={route.id}
            id={route.id}
            nodes={nodes}
            changeTick={changeTick}
            onNavigate={(id) => navigate({ kind: "node", id })}
            onOpenPath={openPath}
            onChanged={refresh}
            onTrash={trash}
            onToast={showToast}
            onGone={() => navigate({ kind: "home" })}
            onContext={setAiContext}
            onOpenAI={() => setAiOpen(true)}
            onOpenTag={(tag) => navigate({ kind: "tag", tag })}
            onCreateTitle={(title) => void createTitled(title)}
            focus={focus}
          />
        )}
        {route.kind === "graph" && <GraphView changeTick={changeTick} onOpen={openNode} />}
        {route.kind === "notes" && <NoteList listKey="all" icon="🗒" title={t("list.allNotes")} notes={listable} nodes={nodes} onOpen={openNode} onTag={(tag) => navigate({ kind: "tag", tag })} />}
        {route.kind === "recent" && (
          <NoteList
            listKey="recent"
            icon="🕘"
            title={t("list.recent")}
            fixedOrder
            notes={recent.map((id) => listable.find((n) => n.id === id)).filter((n): n is NodeMeta => !!n)}
            nodes={nodes}
            empty={t("list.noRecent")}
            onOpen={openNode}
            onTag={(tag) => navigate({ kind: "tag", tag })}
          />
        )}
        {route.kind === "tag" && (
          <NoteList
            listKey={`tag:${route.tag.toLocaleLowerCase("tr")}`}
            icon="#"
            title={route.tag}
            notes={listable.filter((n) => n.tags.some((x) => x.toLocaleLowerCase("tr") === route.tag.toLocaleLowerCase("tr") || x.toLocaleLowerCase("tr").startsWith(`${route.tag.toLocaleLowerCase("tr")}/`)))}
            nodes={nodes}
            onOpen={openNode}
            onTag={(tag) => navigate({ kind: "tag", tag })}
            actions={
              <>
                <button className="secondary" onClick={() => renameTag(route.tag)}>
                  ✎ {t("tags.rename")}
                </button>
                <button className="secondary" onClick={() => setSmartEdit({ name: `#${route.tag}`, tags: [route.tag], match: "all" })}>
                  ⚙︎ {t("tags.smartFromTag")}
                </button>
              </>
            }
          />
        )}
        {route.kind === "smart" &&
          (() => {
            const f = smartFolders.find((x) => x.id === route.id);
            if (!f) return <p className="muted empty-list">{t("list.empty")}</p>;
            return (
              <NoteList
                listKey={`smart:${f.id}`}
                icon={f.icon ?? "⚙︎"}
                title={f.name}
                notes={smartMatches(f, listable)}
                nodes={nodes}
                onOpen={openNode}
                onTag={(tag) => navigate({ kind: "tag", tag })}
                actions={
                  <button className="secondary" onClick={() => setSmartEdit(f)}>
                    ✎ {t("smart.edit")}
                  </button>
                }
              />
            );
          })()}
        {route.kind === "list" &&
          (() => {
            const root = nodes.find((n) => n.id === route.id);
            if (!root) return null;
            const below = descendantIds(nodes, root.id);
            return (
              <NoteList
                listKey={`list:${root.id}`}
                icon={root.icon ?? "◈"}
                title={t("list.notesIn", { title: root.title })}
                notes={listable.filter((n) => n.id === root.id || below.has(n.id))}
                nodes={nodes}
                onOpen={openNode}
                onTag={(tag) => navigate({ kind: "tag", tag })}
                actions={
                  root.archeId === root.id ? (
                    <button className="secondary" onClick={() => void convertToSmart(root)}>
                      ⚙︎ {t("smart.convertArche")}
                    </button>
                  ) : undefined
                }
              />
            );
          })()}
        {route.kind === "attachments" && <AttachmentBrowser changeTick={changeTick} onOpen={openNode} onToast={showToast} />}
        {route.kind === "shadow" && (
          <ShadowView nodes={nodes} changeTick={changeTick} onOpen={(id) => navigate({ kind: "node", id })} onChanged={refresh} onToast={showToast} />
        )}
        {route.kind === "trash" && (
          <TrashView changeTick={changeTick} onChanged={refresh} onToast={showToast} />
        )}
        {route.kind === "home" && <Welcome onCreate={create} onShadow={() => navigate({ kind: "shadow" })} />}
      </main>

      {panel && !focus && (
        <SidePanel
          nodeId={route.kind === "node" ? route.id : null}
          tab={panel}
          onTab={setPanel}
          onClose={() => setPanel(null)}
          nodes={nodes}
          changeTick={changeTick}
          onOpen={openNode}
          onCreateTitle={(title) => void createTitled(title)}
          onToast={showToast}
        />
      )}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {switcherOpen && (
        <QuickSwitcher
          nodes={nodes}
          onClose={() => setSwitcherOpen(false)}
          onCreate={(title) => void createTitled(title)}
          onOpen={(id, newTab) => (newTab ? openInTab(encodeURIComponent(id)) : navigate({ kind: "node", id }))}
        />
      )}
      <AskHost />
      <PagePreview nodes={nodes} />
      {workspacePick && (
        <Picker
          items={Object.keys(workspaces).map((name) => ({ id: name, label: name, icon: "▤", detail: t("ob.workspaceTabs", { n: workspaces[name].hashes.length }) }))}
          placeholder={t("ob.workspacePlaceholder")}
          empty={t("ob.noWorkspaces")}
          onClose={() => setWorkspacePick(false)}
          onPick={(it) => {
            setWorkspacePick(false);
            const ws = workspaces[it.id];
            if (ws?.hashes?.length) selectTab(Math.min(ws.active, ws.hashes.length - 1), ws);
          }}
        />
      )}
      {templatesOpen && (
        <TemplateGallery
          nodes={nodes}
          currentId={route.kind === "node" ? route.id : null}
          onClose={() => setTemplatesOpen(false)}
          onCreated={async (id) => (await refresh(), navigate({ kind: "node", id }))}
          onToast={showToast}
        />
      )}
      {settingsOpen && (
        <Settings onClose={() => setSettingsOpen(false)} onToast={showToast} onChanged={refresh} aiTick={aiTick} onShortcuts={() => setShortcutsOpen(true)} onImport={importNotes} />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {smartEdit && (
        <SmartFolderDialog
          initial={smartEdit}
          nodes={listable}
          tags={tags}
          onSave={saveSmart}
          onDelete={
            smartEdit.id && smartFolders.some((x) => x.id === smartEdit.id)
              ? () => {
                  if (!confirm(t("smart.deleteConfirm", { name: smartEdit.name ?? "" }))) return;
                  setSmartFolders(smartFolders.filter((x) => x.id !== smartEdit.id));
                  setSmartEdit(null);
                  navigate({ kind: "notes" });
                }
              : undefined
          }
          onClose={() => setSmartEdit(null)}
        />
      )}
      <NularcheAI
        open={aiOpen}
        onOpenChange={setAiOpen}
        context={context}
        aiTick={aiTick}
        onToast={showToast}
        onOpenNode={(id) => navigate({ kind: "node", id })}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {onboarding && <Onboarding aiTick={aiTick} onToast={showToast} onDone={() => (setOnboarding(false), setAiOpen(true))} />}
      {searchOpen && (
        <SearchDialog nodes={nodes} onClose={() => setSearchOpen(false)} onPick={(id) => (setSearchOpen(false), navigate({ kind: "node", id }))} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Welcome({ onCreate, onShadow }: { onCreate: (p: ParentTarget) => void; onShadow: () => void }) {
  return (
    <div className="welcome">
      <img src="/logo.png" alt="Nularche" />
      <h1>Nularche</h1>
      <div className="phonetic">/ˈnʌl.ɑːrk/ · nul-ark</div>
      <p className="muted">{t("welcome.tagline")}</p>
      <div className="terms">
        <b>Origin</b>
        <span>{t("term.origin")}</span>
        <b>Arche</b>
        <span>{t("term.arche")}</span>
        <b>Node</b>
        <span>{t("term.node")}</span>
        <b>Shard</b>
        <span>{t("term.shard")}</span>
        <b>Shadow</b>
        <span>{t("term.shadow")}</span>
      </div>
      <div className="row" style={{ display: "flex", gap: 8 }}>
        <button className="primary" onClick={() => onCreate(null)}>
          ◈ {t("common.newArche")}
        </button>
        <button className="secondary" onClick={() => onCreate(SHADOW)}>
          ＋ {t("common.quickNote")}
        </button>
        <button className="secondary" onClick={onShadow}>
          ◐ {t("welcome.openShadow")}
        </button>
      </div>
    </div>
  );
}
