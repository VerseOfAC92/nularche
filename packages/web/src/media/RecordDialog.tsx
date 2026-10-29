// Ses kaydı penceresi: mikrofondan kaydeder (MediaRecorder), duraklatılabilir; bitince dosya `Attachments/`'a yüklenir.

import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { t } from "../i18n/index.ts";

type Phase = "idle" | "recording" | "paused" | "saving" | "error";

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Kayıt bitince Attachments yolunu döndürür (vazgeçilirse null). */
export function RecordDialog({ onDone }: { onDone: (path: string | null) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const clock = useRef({ start: 0, acc: 0 });
  const raf = useRef(0);

  const cleanup = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
  };
  useEffect(() => cleanup, []);

  async function start() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError(t("rec.denied"));
      setPhase("error");
      return;
    }
    const mime = pickMime();
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.start(1000);
    rec.current = r;
    clock.current = { start: Date.now(), acc: 0 };
    setPhase("recording");
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream.current).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(peak / 128);
      const c = clock.current;
      setElapsed(c.acc + (rec.current?.state === "recording" ? Date.now() - c.start : 0));
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }

  function togglePause() {
    const r = rec.current;
    if (!r) return;
    if (r.state === "recording") {
      r.pause();
      clock.current.acc += Date.now() - clock.current.start;
      setPhase("paused");
    } else {
      r.resume();
      clock.current.start = Date.now();
      setPhase("recording");
    }
  }

  async function stop() {
    const r = rec.current;
    if (!r) return;
    setPhase("saving");
    await new Promise<void>((resolve) => {
      r.onstop = () => resolve();
      r.stop();
    });
    cleanup();
    const type = r.mimeType || "audio/webm";
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
    const file = new File(chunks.current, `${t("rec.fileName")} ${stamp}.${ext}`, { type });
    try {
      const { path } = await api.upload(file);
      onDone(path);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  const cancel = () => {
    rec.current?.state !== "inactive" && rec.current?.stop();
    cleanup();
    onDone(null);
  };

  return (
    <div className="overlay" onMouseDown={phase === "idle" || phase === "error" ? cancel : undefined}>
      <div className="dialog small-dialog record-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && cancel()}>
        <header>
          <h2>🎙 {t("rec.title")}</h2>
        </header>
        <div className={`rec-meter ${phase}`}>
          <span className="rec-dot" style={{ transform: `scale(${1 + level * 1.6})` }} />
          <span className="rec-time">{fmt(elapsed)}</span>
          <span className="muted small">{t(phase === "recording" ? "rec.recording" : phase === "paused" ? "rec.paused" : phase === "saving" ? "rec.saving" : "rec.ready")}</span>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button className="secondary" onClick={cancel} disabled={phase === "saving"}>
            {t("common.cancel")}
          </button>
          <span className="grow" />
          {phase === "idle" || phase === "error" ? (
            <button className="primary" onClick={start} autoFocus>
              ● {t("rec.start")}
            </button>
          ) : (
            <>
              <button className="secondary" onClick={togglePause} disabled={phase === "saving"}>
                {phase === "paused" ? t("rec.resume") : t("rec.pause")}
              </button>
              <button className="primary" onClick={stop} disabled={phase === "saving"}>
                ■ {t("rec.stop")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
