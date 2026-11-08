// Yazma zamanlayıcısı (2.0): odak ve mola süreleri (Pomodoro tarzı). Süre bitince yumuşak bir çan çalar ve bir sonraki
// aşamaya geçer. Odak modunda da görünür; sürükleyerek yeri değiştirilebilir.

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";
import { useDraggable } from "../ai/useDraggable.ts";
import { chime } from "./sounds.ts";

type Phase = "focus" | "break";

export function Timer({ onClose, onToast }: { onClose: () => void; onToast: (msg: string) => void }) {
  const [focusMin] = usePref<number>("timerFocus", 25);
  const [breakMin] = usePref<number>("timerBreak", 5);
  const [sound] = usePref<boolean>("timerSound", true);
  const [phase, setPhase] = useState<Phase>("focus");
  const [left, setLeft] = useState(() => focusMin * 60);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  const endAt = useRef<number | null>(null);
  const drag = useDraggable("nlc-timer-pos");

  // Süre ayarı değişince (çalışmıyorsa) baştan başla.
  useEffect(() => {
    if (!running) setLeft((phase === "focus" ? focusMin : breakMin) * 60);
  }, [focusMin, breakMin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return;
    endAt.current = Date.now() + left * 1000;
    const timer = setInterval(() => {
      const rest = Math.max(0, Math.round((endAt.current! - Date.now()) / 1000));
      setLeft(rest);
      if (rest > 0) return;
      clearInterval(timer);
      if (sound) chime();
      const next: Phase = phase === "focus" ? "break" : "focus";
      if (phase === "focus") setRounds((r) => r + 1);
      onToast(next === "break" ? t("ws.timerBreakNow") : t("ws.timerFocusNow"));
      setPhase(next);
      setLeft((next === "focus" ? focusMin : breakMin) * 60);
      setRunning(next === "break");
    }, 250);
    return () => clearInterval(timer);
  }, [running, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = (phase === "focus" ? focusMin : breakMin) * 60;
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const pct = total ? 1 - left / total : 0;
  return (
    <div className={`writing-timer ${phase}`} ref={drag.ref} style={drag.style}>
      <div className="timer-handle" onPointerDown={drag.onPointerDown} onDoubleClick={drag.reset} title={t("ws.dragToMove")}>
        <span>{phase === "focus" ? t("ws.timerFocus") : t("ws.timerBreak")}</span>
        <span className="muted small">{rounds > 0 ? t("ws.timerRounds", { n: rounds }) : ""}</span>
        <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="timer-face" role="timer" aria-live="off">
        <svg viewBox="0 0 36 36" aria-hidden>
          <circle cx="18" cy="18" r="16" className="track" />
          <circle cx="18" cy="18" r="16" className="fill" strokeDasharray={`${(pct * 100.5).toFixed(1)} 100.5`} />
        </svg>
        <span className="timer-time">
          {mm}:{ss}
        </span>
      </div>
      <div className="row timer-controls">
        <button className="primary small-btn" onClick={() => setRunning((r) => !r)}>
          {running ? `⏸ ${t("ws.pause")}` : `▶ ${t("ws.start")}`}
        </button>
        <button className="secondary small-btn" onClick={() => (setRunning(false), setLeft(total))} title={t("ws.reset")}>
          ↺
        </button>
        <button
          className="secondary small-btn"
          title={t("ws.skip")}
          onClick={() => {
            const next: Phase = phase === "focus" ? "break" : "focus";
            setRunning(false);
            setPhase(next);
            setLeft((next === "focus" ? focusMin : breakMin) * 60);
          }}
        >
          ⏭
        </button>
      </div>
    </div>
  );
}
