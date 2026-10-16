// Yapay zekâ seçimi ve bağlantı adımları: Ayarlar'da, ilk açılış sihirbazında ve Nularche AI
// penceresinde (henüz bağlı değilken) aynı bileşen kullanılır.
//   1. Yapay zekânızı seçin (Claude / ChatGPT / Gemini)
//   2. Resmi uygulamayı açın ve kendi hesabınızla giriş yapın
//   3. Nularche'yi bağlayın (MCP kaydı)
//   4. Bağlantı doğrulandı: AI aracı Nularche'ye ilk bağlandığında otomatik algılanır

import { useCallback, useEffect, useState } from "react";
import { copyText, desktop, type AiStatus, type ConnectionStatus, type LauncherId, type ProviderId } from "../desktop.ts";
import { AutoModeSetup } from "./AutoModeSetup.tsx";

const LOGOS: Record<ProviderId, string> = { claude: "✳", chatgpt: "◎", gemini: "✦" };

const ago = (ms: number) => {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "az önce";
  if (d < 3600) return `${Math.floor(d / 60)} dk önce`;
  if (d < 86400) return `${Math.floor(d / 3600)} sa önce`;
  return new Date(ms).toLocaleDateString("tr-TR");
};

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
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!desktop) {
    return (
      <div className="ai-setup">
        <p className="muted">
          Tarayıcı sürümünde bağlantıyı terminalden kurun: <code>npm run connect -- claude-desktop</code> (ya da <code>codex</code>,{" "}
          <code>antigravity</code>, <code>claude-code</code>). Masaüstü uygulamasında bu adımlar tek tıkla yapılır.
        </p>
      </div>
    );
  }
  if (!status) return <p className="muted">Yükleniyor…</p>;

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
      onToast(`${l.name} kurulu değil; indirme sayfası açıldı. Kurup ${name} hesabınızla giriş yapın, sonra “Bağla”ya basın.`);
    } else {
      const res = await desktop!.aiOpen(launcher, null);
      onToast(
        res.opened ? `${l.name} açıldı. ${name} hesabınızla giriş yaptığınızdan emin olun, sonra Nularche'de “Bağla”ya basın.` : (res.message ?? ""),
      );
    }
  }

  async function restartApp() {
    if (!provider) return;
    const res = await desktop!.aiRestart(preferredLauncher(status!, provider));
    onToast(res.ok ? "Yeniden başlatıldı. Yeni bir sohbet açın; Nularche bağlantıyı algılayacak." : (res.error ?? "Yeniden başlatılamadı."));
  }

  async function connect(c: ConnectionStatus) {
    setBusy(c.id);
    setMessage(null);
    let res = await desktop!.aiConnect(c.id);
    if (!res.ok && res.needsRestart) {
      if (
        confirm(
          `${c.mustBeClosed} şu an açık. Bağlantının yüklenmesi için Claude kapatılıp yeniden açılacak; açık sohbet pencereleri kapanır (sohbetleriniz kaybolmaz). Devam edilsin mi?`,
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
          ? "Bağlantı yazıldı. ChatGPT masaüstü uygulamasını (ya da Codex'i) yeniden başlatın; ilk kullanımda Nularche “✓ Bağlandı” diyecek."
          : c.id === "antigravity"
            ? "Bağlantı yazıldı. Terminalde agy'yi yeniden başlatın; ilk kullanımda Nularche “✓ Bağlandı” diyecek."
            : res.restarted
              ? "Bağlantı yazıldı ve Claude yeniden açıldı. Yeni bir sohbet açtığınızda Nularche “✓ Bağlandı” diyecek."
              : "Bağlantı yazıldı. AI aracında yeni bir sohbet açtığınızda Nularche “✓ Bağlandı” diyecek.",
      );
    } else setMessage(`Bağlanamadı: ${res.error}`);
    await refresh();
  }

  async function test() {
    if (!provider) return;
    if (!isProviderConnected(status!, provider)) {
      setMessage(
        "Henüz bağlanmadı: AI uygulaması Nularche'yi yalnızca açılışta yükler. Bağlantıyı kurduktan sonra uygulamayı yeniden başlatın (“Yeniden başlat”) ve yeni bir sohbet açın.",
      );
    }
    const launcher = preferredLauncher(status!, provider);
    const res = await desktop!.aiOpen(launcher, "“nularche” MCP araçlarıyla list_nodes çağır ve Origin'de kaç Node olduğunu bir cümleyle söyle.");
    onToast(res.opened ? "Test istemi panoya kopyalandı; AI penceresine yapıştırıp gönderin." : (res.message ?? "Açılamadı."));
  }

  const connected = provider ? status.clients.filter((c) => c.provider === provider) : [];

  return (
    <div className={`ai-setup ${compact ? "compact" : ""}`}>
      {status.warning && <p className="warn">{status.warning}</p>}
      <div className="ai-mode-title">⚡ Otomatik mod (önerilen)</div>
      <AutoModeSetup onToast={onToast} onChanged={refresh} />
      <div className="ai-mode-title">Üyelik modu: Claude, ChatGPT ya da Gemini uygulamanızla</div>
      <p className="muted small">Ek ücret yok; ancak her istekte AI uygulamasında göndermeniz gerekir. Otomatik mod açıkken bu bölüm kullanılmaz.</p>
      <div className="ai-step">
        <div className="ai-step-head">
          <span className="ai-step-no">1</span> Yapay zekânızı seçin
        </div>
        <div className="provider-cards">
          {status.providers.map((x) => (
            <button key={x.id} className={`provider-card ${provider === x.id ? "on" : ""}`} onClick={() => choose(x.id)}>
              <span className="provider-logo">{LOGOS[x.id]}</span>
              <strong>{x.name}</strong>
              <small>{x.company}</small>
              {isProviderConnected(status, x.id) && <span className="provider-ok">✓ Bağlı</span>}
            </button>
          ))}
        </div>
        <p className="muted small">
          Hangisinin üyeliği sizde varsa onu seçin: <b>Claude</b> (Pro, Max, Team), <b>ChatGPT</b> (Plus, Pro, Business) ya da <b>Gemini</b> (Google
          AI Pro, Ultra). Nularche, seçtiğiniz yapay zekânın kendi resmi uygulamasıyla çalışır; giriş o uygulamada yapılır ve Nularche hesap
          bilgilerinize hiçbir zaman erişmez. Seçiminizi istediğiniz zaman değiştirebilirsiniz.
        </p>
        <AiHowTo connected={connected.length > 0} compact={compact} />
      </div>

      {p && (
        <>
          <div className="ai-step">
            <div className="ai-step-head">
              <span className="ai-step-no">2</span> {p.name} uygulamasını açın ve hesabınızla giriş yapın
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
                      title="Nularche AI bu aracı açsın"
                      onChange={() => desktop!.aiSet({ provider: p.id, launcher: id }).then(refresh)}
                    />
                  )}
                  <span className="ai-row-name">{l.name}</span>
                  <span className={`pill ${l.installed ? "ok" : l.installed === false ? "off" : ""}`}>
                    {l.installed ? "Kurulu" : l.installed === false ? "Kurulu değil" : "Bilinmiyor"}
                  </span>
                  {l.installed !== false && (
                    <button className="secondary" onClick={() => desktop!.aiOpen(id, null).then((r) => !r.opened && r.message && onToast(r.message))}>
                      Aç
                    </button>
                  )}
                  {l.installed !== true && (
                    <button className="secondary" onClick={() => desktop!.aiDownload(l.downloadUrl)}>
                      İndir
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="ai-step">
            <div className="ai-step-head">
              <span className="ai-step-no">3</span> Nularche'yi {p.name}'a bağlayın
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
                      <span className="pill ok">Bağlantı kurulu</span>
                    ) : (
                      <button className="primary" disabled={busy === id || !!("error" in c.plan)} onClick={() => connect(c)}>
                        {busy === id ? "Bağlanıyor…" : plan?.status === "update" ? "Bağlantıyı yenile" : "Bağla"}
                      </button>
                    )}
                  </div>
                  {"error" in c.plan && <p className="warn small">{c.plan.error}</p>}
                  {!compact && plan && plan.status !== "unchanged" && (
                    <p className="muted small">
                      <code>{plan.configPath}</code> dosyasına yalnızca <code>nularche</code> girdisi eklenir; diğer ayarlar korunur ve önce yedek
                      alınır.
                    </p>
                  )}
                  {!compact && c.manualCommand && (
                    <details className="manual">
                      <summary>Terminalden elle bağlamak için komut</summary>
                      <pre className="cmd">{c.manualCommand}</pre>
                      <button className="secondary" onClick={() => copyText(c.manualCommand!).then(() => onToast("Komut kopyalandı"))}>
                        Kopyala
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
              <span className="ai-step-no">4</span> Bağlantı
            </div>
            {connected.length ? (
              connected.map((c) => (
                <p key={c.name} className="ok">
                  ✓ {p.name} bağlandı{" "}
                  <span className="muted small">
                    ({c.name}, son kullanım {ago(c.lastSeen)})
                  </span>
                </p>
              ))
            ) : (
              <p className="muted small">
                Bekleniyor… {p.name} uygulamasında yeni bir sohbet açtığınızda Nularche bağlantıyı otomatik algılar ve öne gelir.
              </p>
            )}
            <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="secondary" onClick={test}>
                Bağlantıyı test et
              </button>
              {!connected.length && (
                <button className="secondary" onClick={restartApp} title="AI uygulaması Nularche bağlantısını açılışta yükler">
                  {p.name} uygulamasını yeniden başlat
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const APPS: { name: string; apps: string }[] = [
  { name: "Claude", apps: "Claude Desktop ya da Claude Code (terminal)" },
  { name: "ChatGPT", apps: "ChatGPT masaüstü uygulaması ya da Codex (terminal)" },
  { name: "Gemini", apps: "Google Antigravity (terminal aracı agy)" },
];

/** Yapay zekânın nasıl bağlanıp kullanılacağını anlatan adım adım rehber. */
function AiHowTo({ connected, compact }: { connected: boolean; compact: boolean }) {
  return (
    <details className="ai-howto" open={!connected && !compact}>
      <summary>Nasıl bağlanır ve nasıl kullanılır?</summary>
      <div className="ai-howto-body">
        <h5>Bağlantı (bir kez yapılır)</h5>
        <ol>
          <li>Yukarıdan yapay zekânızı seçin. Nularche onun resmi uygulamasını açar; uygulama kurulu değilse indirme sayfasını açar.</li>
          <li>Açılan uygulamada kendi hesabınızla (üyeliğinizle) giriş yapın.</li>
          <li>
            Aşağıdaki <b>3. adımda</b> “Bağla”ya basın. Nularche bağlantıyı kendisi kurar; gerekirse uygulamayı yeniden başlatır.
          </li>
          <li>
            Yapay zekâ uygulamasında yeni bir sohbet açın. Nularche bağlantıyı algılar, öne gelir ve <b>“✓ … bağlandı”</b> der.
          </li>
        </ol>
        <h5>Kullanım</h5>
        <ol>
          <li>
            Bir Node (sayfa) açın ve sağ alttaki <b>✳ Nularche AI</b> penceresini açın.
          </li>
          <li>
            Hazır eylemlerden birini seçin (Düzelt, Özetle, Genişlet, Yapılacaklar, Bağla, Çevir) ya da ne istediğinizi yazın. Metin seçerseniz
            yalnızca o bölüm işlenir.
          </li>
          <li>
            <b>Üyelik modunda</b> istek, seçtiğiniz yapay zekâ uygulamasında hazır açılır; göndermeniz yeterlidir. <b>Otomatik modda</b> hiçbir şey
            yapmanız gerekmez, istek arka planda işlenir.
          </li>
          <li>
            Yapılan düzenleme notunuza uygulanır; cevap, ilerleme ve <b>Geri al</b> düğmesi Nularche AI penceresinde görünür.
          </li>
        </ol>
        <h5>Hangi uygulama kullanılır?</h5>
        <ul>
          {APPS.map((a) => (
            <li key={a.name}>
              <b>{a.name}:</b> {a.apps}
            </li>
          ))}
        </ul>
        <p className="muted small">
          İpucu: Her istekte uygulamaya geçmek istemiyorsanız yukarıdaki <b>Otomatik mod</b>u (ücretsiz Gemini anahtarı) açın; o zaman her şey
          Nularche içinde kendiliğinden olur.
        </p>
      </div>
    </details>
  );
}
