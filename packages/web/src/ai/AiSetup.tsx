// Yapay zekâ seçimi ve bağlantı adımları: Ayarlar'da, ilk açılış sihirbazında ve Nularche AI
// penceresinde (henüz bağlı değilken) aynı bileşen kullanılır.
//   1. Yapay zekânızı seçin (Claude / ChatGPT / Gemini)
//   2. Resmi uygulamayı açın ve kendi hesabınızla giriş yapın
//   3. Nularche'yi bağlayın (MCP kaydı)
//   4. Bağlantı doğrulandı: AI aracı Nularche'ye ilk bağlandığında otomatik algılanır

import { useCallback, useEffect, useState } from "react";
import { copyText, desktop, type AiStatus, type ConnectionStatus, type LauncherId, type ProviderId } from "../desktop.ts";
import { AutoModeSetup } from "./AutoModeSetup.tsx";
import { ago, t } from "../i18n/index.ts";

const LOGOS: Record<ProviderId, string> = { claude: "✳", chatgpt: "◎", gemini: "✦" };

export function useAiStatus(tick = 0): [AiStatus | null, () => Promise<void>] {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const refresh = useCallback(async () => {
    if (desktop) setStatus(await desktop.aiStatus());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, tick]);
  return [status, refresh];
}

/** Seçili sağlayıcı için açma yolu: kullanıcının tercihi, yoksa kurulu olan ilk araç. */
export function preferredLauncher(status: AiStatus, provider: ProviderId): LauncherId {
  const p = status.providers.find((x) => x.id === provider)!;
  const chosen = status.launchers[provider];
  if (chosen && p.launchers.includes(chosen)) return chosen;
  return p.launchers.find((id) => status.launcherStatus.find((l) => l.id === id)?.installed) ?? p.launchers[0];
}

export function isProviderConnected(status: AiStatus, provider: ProviderId): boolean {
  return status.clients.some((c) => c.provider === provider);
}

export function AiSetup({ tick = 0, compact = false, onToast }: { tick?: number; compact?: boolean; onToast: (msg: string) => void }) {
  const [status, refresh] = useAiStatus(tick);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Bağlantı beklenirken durumu sık sık yenile (AI aracı bağlanınca algılansın).
  useEffect(() => {
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!desktop) {
    return (
      <div className="ai-setup">
        <p className="muted">
          {t("ais.browser1")} <code>npm run connect -- claude-desktop</code> ({t("ais.browserOr")} <code>codex</code>, <code>antigravity</code>,{" "}
          <code>claude-code</code>). {t("ais.browser2")}
        </p>
      </div>
    );
  }
  if (!status) return <p className="muted">{t("common.loading")}</p>;

  const provider = status.provider;
  const p = status.providers.find((x) => x.id === provider);

  /** Yapay zekâ seçilince resmi uygulamasına yönlendir: kuruluysa açılır, değilse indirme sayfası açılır. */
  async function choose(id: ProviderId) {
    await desktop!.aiSet({ provider: id });
    setMessage(null);
    const fresh = await desktop!.aiStatus();
    await refresh();
    const name = fresh.providers.find((x) => x.id === id)!.name;
    const launcher = preferredLauncher(fresh, id);
    const l = fresh.launcherStatus.find((x) => x.id === launcher)!;
    if (l.installed === false) {
      await desktop!.aiDownload(l.downloadUrl);
      onToast(t("ais.notInstalled", { app: l.name, name }));
    } else {
      const res = await desktop!.aiOpen(launcher, null);
      onToast(
        res.opened ? t("ais.opened", { app: l.name, name }) : (res.message ?? ""),
      );
    }
  }

  async function restartApp() {
    if (!provider) return;
    const res = await desktop!.aiRestart(preferredLauncher(status!, provider));
    onToast(res.ok ? t("ais.restarted") : (res.error ?? t("ais.restartFailed")));
  }

  async function connect(c: ConnectionStatus) {
    setBusy(c.id);
    setMessage(null);
    let res = await desktop!.aiConnect(c.id);
    if (!res.ok && res.needsRestart) {
      if (
        confirm(
          t("ais.restartConfirm", { app: c.mustBeClosed ?? "" }),
        )
      ) {
        res = await desktop!.aiConnect(c.id, { restartApp: true });
      } else {
        setBusy(null);
        return;
      }
    }
    setBusy(null);
    if (res.ok && !res.restarted && provider) {
      // Bağlantı yazıldıktan sonra AI uygulamasını aç; yeni sohbette Nularche araçları yüklenir.
      void desktop!.aiOpen(preferredLauncher(status!, provider), null);
    }
    if (res.ok) {
      setMessage(
        c.id === "codex"
          ? t("ais.writtenCodex")
          : c.id === "antigravity"
            ? t("ais.writtenAgy")
            : res.restarted
              ? t("ais.writtenRestarted")
              : t("ais.written"),
      );
    } else setMessage(t("ais.connectFailed", { error: res.error ?? "" }));
    await refresh();
  }

  async function test() {
    if (!provider) return;
    if (!isProviderConnected(status!, provider)) {
      setMessage(
        t("ais.notYet"),
      );
    }
    const launcher = preferredLauncher(status!, provider);
    const res = await desktop!.aiOpen(launcher, t("ais.testPrompt"));
    onToast(res.opened ? t("ais.testCopied") : (res.message ?? t("ais.openFailed")));
  }

  const connected = provider ? status.clients.filter((c) => c.provider === provider) : [];

  return (
    <div className={`ai-setup ${compact ? "compact" : ""}`}>
      {status.warning && <p className="warn">{status.warning}</p>}
      <div className="ai-mode-title">⚡ {t("ais.autoTitle")}</div>
      <AutoModeSetup onToast={onToast} onChanged={refresh} />
      <div className="ai-mode-title">{t("ais.subTitle")}</div>
      <p className="muted small">{t("ais.subHint")}</p>
      <div className="ai-step">
        <div className="ai-step-head">
          <span className="ai-step-no">1</span> {t("ais.step1")}
        </div>
        <div className="provider-cards">
          {status.providers.map((x) => (
            <button key={x.id} className={`provider-card ${provider === x.id ? "on" : ""}`} onClick={() => choose(x.id)}>
              <span className="provider-logo">{LOGOS[x.id]}</span>
              <strong>{x.name}</strong>
              <small>{x.company}</small>
              {isProviderConnected(status, x.id) && <span className="provider-ok">✓ {t("ais.connected")}</span>}
            </button>
          ))}
        </div>
        <p className="muted small">{t("ais.chooseHint")}</p>
        <AiHowTo connected={connected.length > 0} compact={compact} />
      </div>

      {p && (
        <>
          <div className="ai-step">
            <div className="ai-step-head">
              <span className="ai-step-no">2</span> {t("ais.step2", { name: p.name })}
            </div>
            {p.launchers.map((id) => {
              const l = status.launcherStatus.find((x) => x.id === id)!;
              const preferred = preferredLauncher(status, p.id) === id;
              return (
                <div className="ai-row" key={id}>
                  {p.launchers.length > 1 && (
                    <input
                      type="radio"
                      name={`launcher-${p.id}`}
                      checked={preferred}
                      title={t("ais.launcherPick")}
                      onChange={() => desktop!.aiSet({ provider: p.id, launcher: id }).then(refresh)}
                    />
                  )}
                  <span className="ai-row-name">{l.name}</span>
                  <span className={`pill ${l.installed ? "ok" : l.installed === false ? "off" : ""}`}>
                    {l.installed ? t("ais.installed") : l.installed === false ? t("ais.notInstalledPill") : t("ais.unknown")}
                  </span>
                  {l.installed !== false && (
                    <button className="secondary" onClick={() => desktop!.aiOpen(id, null).then((r) => !r.opened && r.message && onToast(r.message))}>
                      {t("ais.open")}
                    </button>
                  )}
                  {l.installed !== true && (
                    <button className="secondary" onClick={() => desktop!.aiDownload(l.downloadUrl)}>
                      {t("ais.download")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="ai-step">
            <div className="ai-step-head">
              <span className="ai-step-no">3</span> {t("ais.step3", { name: p.name })}
            </div>
            {p.connections.map((id) => {
              const c = status.connections.find((x) => x.id === id)!;
              const plan = "status" in c.plan ? c.plan : null;
              return (
                <div key={id}>
                  <div className="ai-row">
                    <span className="ai-row-name" title={c.description}>
                      {c.name}
                    </span>
                    {plan?.status === "unchanged" ? (
                      <span className="pill ok">{t("ais.linkReady")}</span>
                    ) : (
                      <button className="primary" disabled={busy === id || !!("error" in c.plan)} onClick={() => connect(c)}>
                        {busy === id ? t("ais.connecting") : plan?.status === "update" ? t("ais.refreshLink") : t("ais.connect")}
                      </button>
                    )}
                  </div>
                  {"error" in c.plan && <p className="warn small">{c.plan.error}</p>}
                  {!compact && plan && plan.status !== "unchanged" && (
                    <p className="muted small">
                      <code>{plan.configPath}</code>: {t("ais.configHint")}
                    </p>
                  )}
                  {!compact && c.manualCommand && (
                    <details className="manual">
                      <summary>{t("ais.manual")}</summary>
                      <pre className="cmd">{c.manualCommand}</pre>
                      <button className="secondary" onClick={() => copyText(c.manualCommand!).then(() => onToast(t("ais.cmdCopied")))}>
                        {t("ais.copy")}
                      </button>
                    </details>
                  )}
                </div>
              );
            })}
            {message && <p className="muted small">{message}</p>}
          </div>

          <div className="ai-step">
            <div className="ai-step-head">
              <span className="ai-step-no">4</span> {t("ais.step4")}
            </div>
            {connected.length ? (
              connected.map((c) => (
                <p key={c.name} className="ok">
                  ✓ {t("ais.providerConnected", { name: p.name })}{" "}
                  <span className="muted small">({t("ais.lastUsed", { client: c.name, when: ago(c.lastSeen) })})</span>
                </p>
              ))
            ) : (
              <p className="muted small">{t("ais.waiting", { name: p.name })}</p>
            )}
            <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="secondary" onClick={test}>
                {t("ais.test")}
              </button>
              {!connected.length && (
                <button className="secondary" onClick={restartApp} title={t("ais.restartHint")}>
                  {t("ais.restartApp", { name: p.name })}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const APPS = [
  ["Claude", "howto.appsClaude"],
  ["ChatGPT", "howto.appsChatgpt"],
  ["Gemini", "howto.appsGemini"],
] as const;

/** Yapay zekânın nasıl bağlanıp kullanılacağını anlatan adım adım rehber. */
function AiHowTo({ connected, compact }: { connected: boolean; compact: boolean }) {
  return (
    <details className="ai-howto" open={!connected && !compact}>
      <summary>{t("howto.title")}</summary>
      <div className="ai-howto-body">
        <h5>{t("howto.connectTitle")}</h5>
        <ol>
          <li>{t("howto.c1")}</li>
          <li>{t("howto.c2")}</li>
          <li>{t("howto.c3")}</li>
          <li>{t("howto.c4")}</li>
        </ol>
        <h5>{t("howto.useTitle")}</h5>
        <ol>
          <li>{t("howto.u1")}</li>
          <li>{t("howto.u2")}</li>
          <li>{t("howto.u3")}</li>
          <li>{t("howto.u4")}</li>
        </ol>
        <h5>{t("howto.appsTitle")}</h5>
        <ul>
          {APPS.map(([name, key]) => (
            <li key={name}>
              <b>{name}:</b> {t(key)}
            </li>
          ))}
        </ul>
        <p className="muted small">{t("howto.tip")}</p>
      </div>
    </details>
  );
}
