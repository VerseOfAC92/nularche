// Stüdyo özelliklerinin arayüzdeki giriş noktaları (2.0): yeni yazma projesi menüsü, not araç çubuğundaki
// Marginalia / Epoch / Diptych / Clepsydra / Aura düğmeleri ve Aura (ses) penceresi. Her düğmenin ipucu, terimin
// Nularche dilindeki anlamını da gösterir; böylece özellikler menü çubuğunu bilmeden de bulunur.

import { useEffect, useRef, useState, type RefObject } from "react";
import { runCommand } from "../commands.ts";
import { t, type StringKey } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";
import { AMBIENCES, typeSound, type Ambience, type TypeProfile } from "./sounds.ts";

/** "Ad — anlamı" biçiminde ipucu. */
export const termTip = (name: string, meaning: StringKey, key?: string) => `${name}${key ? ` (${key})` : ""} — ${t(meaning)}`;

export const PROJECT_KINDS: { cmd: string; icon: string; name: string; meaning: StringKey }[] = [
  { cmd: "manuscript.new", icon: "📕", name: "Codex", meaning: "gloss.codex" },
  { cmd: "outline.new", icon: "🗂", name: "Axis", meaning: "gloss.axis" },
  { cmd: "cards.new", icon: "🗃", name: "Mosaic", meaning: "gloss.mosaic" },
  { cmd: "wiki.new", icon: "📚", name: "Lore", meaning: "gloss.lore" },
];

/** Açılır pencere dışına tıklanınca ya da Esc ile kapanır. */
function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-menu-trigger]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("mousedown", onDown, true);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("mousedown", onDown, true);
      removeEventListener("keydown", onKey);
    };
  }, [ref, onClose]);
}

/** Yeni Codex / Axis / Mosaic / Lore seçtiren açılır menü. */
export function NewProjectMenu({ onClose, anchor }: { onClose: () => void; anchor?: DOMRect }) {
  // Kenar çubuğu taşanı kırptığı için menü düğmenin yanında sabit konumda açılır.
  const style = anchor ? { position: "fixed" as const, left: anchor.right + 6, top: Math.min(anchor.top, window.innerHeight - 300) } : undefined;
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  return (
    <div className="menu-pop project-menu" style={style} ref={ref} role="menu">
      <div className="menu-title">{t("ws.newProject")}</div>
      {PROJECT_KINDS.map((k) => (
        <button key={k.cmd} role="menuitem" onClick={() => (onClose(), runCommand(k.cmd))}>
          <span className="pm-icon">{k.icon}</span>
          <span>
            <b>{k.name}</b>
            <small>{t(k.meaning)}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Aura: daktilo sesleri ve ortam sesi için küçük pencere. */
export function AuraMenu({ onClose, anchor }: { onClose: () => void; anchor: DOMRect }) {
  // Sayfa bölmesi taşanı kırptığı için pencere düğmenin altında sabit konumda açılır.
  const style = { position: "fixed" as const, top: anchor.bottom + 6, left: Math.max(8, Math.min(anchor.right - 260, window.innerWidth - 268)), right: "auto" };
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const [typeOn, setTypeOn] = usePref<boolean>("typeSounds", false);
  const [vol] = usePref<number>("typeVolume", 0.5);
  const [profile, setProfile] = usePref<TypeProfile>("typeProfile", "light");
  const [ambience, setAmbience] = usePref<Ambience>("ambience", "off");
  const [level, setLevel] = usePref<number>("ambienceLevel", 0.5);
  return (
    <div className="menu-pop aura-menu" ref={ref} style={style}>
      <div className="menu-title">Aura</div>
      <p className="muted small">{t("gloss.aura")}</p>
      <label className="check">
        <input type="checkbox" checked={typeOn} onChange={(e) => (setTypeOn(e.target.checked), e.target.checked && typeSound("key", vol, profile))} /> {t("ws.typeSoundsShort")}
      </label>
      {typeOn && (
        <div className="segmented small">
          {(["light", "heavy"] as const).map((p) => (
            <button key={p} className={profile === p ? "on" : ""} onClick={() => (setProfile(p), typeSound("key", vol, p))}>
              {t(p === "light" ? "ws.portable" : "ws.desk")}
            </button>
          ))}
        </div>
      )}
      <div className="aura-list">
        {AMBIENCES.map((a) => (
          <button key={a} className={ambience === a ? "on" : ""} onClick={() => setAmbience(a)}>
            {AMBIENCE_ICON[a]} {t(`ws.amb.${a}`)}
          </button>
        ))}
      </div>
      {ambience !== "off" && (
        <label className="field inline">
          <span>{t("ws.ambienceLevel")}</span>
          <input type="range" min={0} max={1} step={0.05} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
        </label>
      )}
    </div>
  );
}

const AMBIENCE_ICON: Record<Ambience, string> = { off: "🔇", rain: "🌧", clock: "🕰", night: "🌙", fire: "🔥" };

/** Not sayfasının üst çubuğundaki stüdyo düğmeleri. */
export function StudioToolbar({ comments, onComments, onHistory }: { comments: number; onComments: () => void; onHistory: () => void }) {
  const [aura, setAura] = useState<DOMRect | null>(null);
  const [timerOpen] = usePref<boolean>("timerOpen", false);
  const [typeOn] = usePref<boolean>("typeSounds", false);
  const [ambience] = usePref<Ambience>("ambience", "off");
  const auraOn = typeOn || ambience !== "off";
  return (
    <div className="studio-toolbar" role="toolbar" aria-label={t("ws.studio")}>
      <button className="icon-btn" title={termTip("Marginalia", "gloss.marginalia", "⌥⌘M")} onClick={onComments}>
        ✎{comments > 0 && <span className="tb-badge">{comments}</span>}
      </button>
      <button className="icon-btn" title={termTip("Epoch", "gloss.epoch", "⌥⌘S")} onClick={() => (runCommand("note.checkpoint"), onHistory())}>
        ⚑
      </button>
      <button className="icon-btn" title={termTip("Diptych", "gloss.diptych")} onClick={() => runCommand("split.open")}>
        ◫
      </button>
      <button className={`icon-btn ${timerOpen ? "on" : ""}`} title={termTip("Clepsydra", "gloss.clepsydra", "⌥⌘P")} onClick={() => runCommand("timer.toggle")}>
        ⧗
      </button>
      <div className="rel">
        <button data-menu-trigger className={`icon-btn ${auraOn ? "on" : ""}`} title={termTip("Aura", "gloss.aura")} onClick={(e) => setAura(aura ? null : e.currentTarget.getBoundingClientRect())}>
          ♪
        </button>
        {aura && <AuraMenu anchor={aura} onClose={() => setAura(null)} />}
      </div>
    </div>
  );
}
