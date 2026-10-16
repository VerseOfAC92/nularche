import { useCallback, useEffect, useRef, useState } from "react";
import { api, SHADOW, type NodeMeta, type ParentTarget } from "./api.ts";
import { desktop } from "./desktop.ts";
import { NodeView } from "./NodeView.tsx";
import { SearchDialog } from "./SearchDialog.tsx";
import { Settings } from "./Settings.tsx";
import { ShadowView } from "./ShadowView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { NularcheAI, type AiContext } from "./ai/NularcheAI.tsx";
import { Onboarding } from "./ai/Onboarding.tsx";
import { PROVIDER_LABEL } from "./ai/prompts.ts";
import { t } from "./i18n/index.ts";

export type Route = { kind: "home" } | { kind: "shadow" } | { kind: "node"; id: string };

function parseHash(): Route {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return { kind: "home" };
  if (h === "shadow") return { kind: "shadow" };
  return { kind: "node", id: h };
}

function routeHash(r: Route): string {
  return r.kind === "home" ? "" : r.kind === "shadow" ? "shadow" : encodeURIComponent(r.id);
}

export function App() {
  const [nodes, setNodes] = useState<NodeMeta[]>([]);
  const [route, setRoute] = useState<Route>(parseHash);
  const [originName, setOriginName] = useState("");
  const [changeTick, setChangeTick] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const navigate = useCallback((r: Route) => {
    location.hash = routeHash(r);
    setRoute(r);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setNodes(await api.list());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
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

  const trash = useCallback(
    async (n: NodeMeta) => {
      const subCount = nodes.filter((x) => x.path.startsWith(n.path.slice(0, -3) + "/")).length;
      const msg = subCount ? t("app.trashConfirmChildren", { title: n.title, count: subCount }) : t("app.trashConfirm", { title: n.title });
      if (!confirm(msg)) return;
      await api.trash(n.id);
      if (route.kind === "node") {
        const cur = nodes.find((x) => x.id === route.id);
        if (cur && (cur.id === n.id || cur.path.startsWith(n.path.slice(0, -3) + "/"))) navigate({ kind: "home" });
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
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        void create(SHADOW);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [create]);

  const shadowCount = nodes.filter((n) => n.archeId === null).length;
  const context = route.kind === "node" && aiContext.nodeId === route.id ? aiContext : {};

  return (
    <div className="app">
      <Sidebar
        nodes={nodes}
        route={route}
        originName={originName}
        shadowCount={shadowCount}
        onNavigate={navigate}
        onCreate={create}
        onTrash={trash}
        onChanged={refresh}
        onError={setError}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="main">
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
          />
        )}
        {route.kind === "shadow" && (
          <ShadowView nodes={nodes} changeTick={changeTick} onOpen={(id) => navigate({ kind: "node", id })} onChanged={refresh} onToast={showToast} />
        )}
        {route.kind === "home" && <Welcome onCreate={create} onShadow={() => navigate({ kind: "shadow" })} />}
      </main>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} onToast={showToast} onChanged={refresh} aiTick={aiTick} />}
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
