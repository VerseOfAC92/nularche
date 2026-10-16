// Nularche AI: sağ altta her zaman duran, küçültülebilir pencere. Kullanıcı isteğini burada verir;
// istek seçilen AI aracına (kullanıcının kendi hesabıyla açtığı resmi uygulama) iletilir, AI işi
// "nularche" MCP araçlarıyla yapar ve ilerleme, cevap ve geri alma burada görünür.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type AiRequest } from "../api.ts";
import { copyText, desktop } from "../desktop.ts";
import { AiSetup, isProviderConnected, preferredLauncher, useAiStatus } from "./AiSetup.tsx";
import { useAutoStatus } from "./AutoModeSetup.tsx";
import { AI_ACTIONS, PROVIDER_LABEL, requestPrompt } from "./prompts.ts";

export interface AiContext {
  nodeId?: string;
  nodeTitle?: string;
  selection?: string;
}

const STATUS_TEXT = (r: AiRequest, ai: string, auto: boolean) =>
  r.status === "pending"
    ? auto
      ? "Gönderiliyor…"
      : `${ai} uygulamasında gönderin…`
    : r.status === "received"
      ? `${ai} çalışıyor…`
      : r.status === "failed"
        ? "Tamamlanamadı"
        : "Tamamlandı";

export function NularcheAI({
  open,
  onOpenChange,
  context,
  aiTick,
  onToast,
  onOpenNode,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: AiContext;
  aiTick: number;
  onToast: (msg: string) => void;
  onOpenNode: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const [status, refreshStatus] = useAiStatus(aiTick);
  const [auto, refreshAuto] = useAutoStatus(aiTick);
  const [requests, setRequests] = useState<AiRequest[]>([]);
  const [text, setText] = useState("");
  const [useSelection, setUseSelection] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.aiState().then(
      (s) => setRequests(s.requests),
      () => undefined,
    );
    void refreshStatus();
    void refreshAuto();
  }, [aiTick, refreshStatus, refreshAuto]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [requests.length, open]);

  const autoOn = !!(auto?.enabled && auto.hasKey);
  const provider = autoOn ? "gemini" : (status?.provider ?? null);
  const ai = autoOn ? "Gemini" : provider ? PROVIDER_LABEL[provider] : "AI";
  const connected = autoOn || !!(status && provider && isProviderConnected(status, provider));
  const needsSetup = !!desktop && !autoOn && (!status || !provider || !connected);
  const ordered = useMemo(() => [...requests].reverse().slice(-30), [requests]);
  const selection = useSelection && context.selection?.trim() ? context.selection.trim() : undefined;

  async function send(label: string, instruction: string) {
    if (!instruction.trim() || sending) return;
    setSending(true);
    try {
      const req = await api.aiRequest({ provider, label, instruction, nodeId: context.nodeId, nodeTitle: context.nodeTitle, selection });
      setRequests((r) => [req, ...r]);
      setText("");
      const prompt = requestPrompt(req);
      // Modu gönderimden hemen önce yeniden denetle (ayar az önce değişmiş olabilir).
      const current = desktop ? await desktop.autoStatus() : null;
      if (desktop && current?.enabled && current.hasKey) {
        // Otomatik mod: istek arka planda işlenir; ilerleme ve cevap canlı olarak bu pencerede görünür.
        const res = await desktop.autoRun(req.id);
        if (!res.ok && res.error) onToast(res.error);
      } else if (desktop && status && provider) {
        const res = await desktop.aiOpen(preferredLauncher(status, provider), prompt);
        onToast(
          res.opened
            ? `İstek ${ai}'da hazır: Enter'a basın (kutu boşsa ⌘V ile yapıştırın).`
            : (res.message ?? "AI aracı açılamadı; istem panoya kopyalandı."),
        );
      } else {
        await copyText(prompt).then(
          () => onToast("İstem panoya kopyalandı; bağlı AI aracınıza yapıştırın."),
          () => onToast("İstek oluşturuldu. “İstemi kopyala” ile kopyalayıp AI aracınıza yapıştırın."),
        );
      }
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function undo(r: AiRequest) {
    const res = await api.aiUndo(r.id);
    onToast(
      res.restored.length
        ? `Geri alındı: ${res.restored.join(", ")}${res.skipped.length ? ` · Atlanan (sonradan değişmiş): ${res.skipped.join(", ")}` : ""}`
        : `Geri alınamadı; Node'lar sonradan değişmiş: ${res.skipped.join(", ")}`,
    );
  }

  if (!open) {
    return (
      <button className={`nai-fab ${connected ? "on" : ""}`} onClick={() => onOpenChange(true)} title="Nularche AI">
        <span className="nai-fab-icon">✳</span> Nularche AI
        <span className={`nai-dot ${connected ? "on" : ""}`} />
      </button>
    );
  }

  return (
    <div className="nai-panel" role="dialog" aria-label="Nularche AI">
      <header className="nai-head">
        <span className="nai-title">✳ Nularche AI</span>
        {provider && (
          <button className={`nai-provider ${connected ? "on" : ""}`} onClick={onOpenSettings} title="Yapay zekâ ayarları">
            <span className={`nai-dot ${connected ? "on" : ""}`} /> {ai}
            {autoOn ? " · Otomatik" : ""}
          </button>
        )}
        <button className="icon-btn" onClick={() => onOpenChange(false)} title="Küçült">
          —
        </button>
      </header>

      {needsSetup ? (
        <div className="nai-body">
          <AiSetup tick={aiTick} compact onToast={onToast} />
        </div>
      ) : (
        <>
          <div className="nai-body" ref={listRef}>
            {ordered.length === 0 && (
              <div className="nai-empty">
                <p>
                  Merhaba! Bir Node açıp aşağıdan bir eylem seçin ya da ne istediğinizi yazın. İstek {ai}'a gider, {ai} notlarınızda çalışır; sonuç ve
                  cevap burada görünür.
                </p>
              </div>
            )}
            {ordered.map((r) => (
              <div key={r.id} className="nai-turn">
                <div className="nai-user">
                  <div>{r.label === r.instruction ? r.instruction : r.label}</div>
                  {r.nodeTitle && (
                    <button className="nai-chip" onClick={() => r.nodeId && onOpenNode(r.nodeId)}>
                      ◇ {r.nodeTitle}
                    </button>
                  )}
                  {r.selection && <span className="nai-chip">seçili metin</span>}
                </div>
                <div className={`nai-status ${r.status}`}>
                  {STATUS_TEXT(r, r.provider ? PROVIDER_LABEL[r.provider] : ai, autoOn)}
                  {r.status === "done" && r.client?.startsWith("Gemini ·") && <span className="nai-model"> · {r.client.slice(9)}</span>}
                  {desktop && autoOn && (r.status === "failed" || (r.status !== "done" && Date.now() - r.createdAt > 60_000)) && (
                    <button
                      className="nai-copy"
                      onClick={async () => {
                        const res = await desktop!.autoRetry(r.id);
                        if (!res.ok && res.error) onToast(res.error);
                      }}
                    >
                      ↻ Tekrar dene
                    </button>
                  )}
                  {r.status === "pending" && !autoOn && (
                    <button
                      className="nai-copy"
                      onClick={() =>
                        copyText(requestPrompt(r)).then(
                          () => onToast("İstem panoya kopyalandı."),
                          () => onToast("Pano izni yok; istemi kopyalayamadım."),
                        )
                      }
                    >
                      İstemi kopyala
                    </button>
                  )}
                </div>
                {r.reply && <div className="nai-reply">{r.reply}</div>}
                {r.changes.length > 0 && (
                  <div className="nai-changes">
                    {[...new Map(r.changes.map((c) => [c.nodeId, c])).values()].map((c) => (
                      <button key={c.nodeId} className="nai-chip" onClick={() => onOpenNode(c.nodeId)}>
                        ✎ {c.title}
                      </button>
                    ))}
                    {r.undoneAt ? (
                      <span className="muted small">Geri alındı</span>
                    ) : (
                      <button className="nai-undo" onClick={() => undo(r)}>
                        ↶ Geri al
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="nai-composer">
            <div className="nai-context">
              {context.nodeTitle ? (
                <span className="nai-chip">◇ {context.nodeTitle}</span>
              ) : (
                <span className="muted small">Bir Node açın ya da genel bir soru sorun</span>
              )}
              {context.selection?.trim() && (
                <label className="nai-chip">
                  <input type="checkbox" checked={useSelection} onChange={(e) => setUseSelection(e.target.checked)} /> seçili metin (
                  {context.selection.trim().length})
                </label>
              )}
            </div>
            {context.nodeId && (
              <div className="nai-actions">
                {AI_ACTIONS.map((a) => (
                  <button
                    key={a.label}
                    disabled={sending}
                    onClick={() => send(a.label, selection ? `${a.instruction} Yalnızca kullanıcının seçtiği metne uygula.` : a.instruction)}
                  >
                    <span>{a.icon}</span> {a.label}
                  </button>
                ))}
              </div>
            )}
            <form
              className="nai-input"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text.trim().slice(0, 60), text);
              }}
            >
              <textarea
                value={text}
                placeholder={`${ai}'a ne yaptırmak istersiniz?`}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(text.trim().slice(0, 60), text);
                  }
                }}
              />
              <button className="primary" disabled={!text.trim() || sending}>
                ↑
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
