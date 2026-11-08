// Stüdyo görünümlerinin küçük ortak parçaları.

import { t } from "../i18n/index.ts";
import { LABEL_COLORS } from "./useWriting.ts";

export function ColorDots({ value, onChange }: { value?: string; onChange: (id: string | undefined) => void }) {
  return (
    <div className="lbl-dots" role="radiogroup" aria-label={t("ws.color")}>
      <button className={`lbl-dot none ${!value ? "on" : ""}`} title={t("ws.noColor")} aria-label={t("ws.noColor")} onClick={() => onChange(undefined)} />
      {LABEL_COLORS.map((c) => (
        <button
          key={c.id}
          className={`lbl-dot ${value === c.id ? "on" : ""}`}
          style={{ background: c.value }}
          aria-label={c.id}
          title={c.id}
          onClick={() => onChange(c.id)}
        />
      ))}
    </div>
  );
}

export function Progress({ value, goal, label }: { value: number; goal?: number; label?: string }) {
  if (!goal) return label ? <span className="muted small">{label}</span> : null;
  const pct = Math.min(100, Math.round((value / goal) * 100));
  return (
    <span className="goal-progress" title={`${value.toLocaleString()} / ${goal.toLocaleString()}`}>
      <span className="goal-bar">
        <span style={{ width: `${pct}%` }} className={pct >= 100 ? "done" : ""} />
      </span>
      <span className="muted small">{label ?? `${value.toLocaleString()} / ${goal.toLocaleString()}`} · {t("ws.percent", { n: pct })}</span>
    </span>
  );
}
