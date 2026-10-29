// Yazma arka planı seçici (Writer'daki "Görünüm ve Arka Plan"): manzaralar, renk paletleri, özel renk ve kendi görseliniz.
// Seçim hemen uygulanır ve Origin tercihlerine kaydedilir. Odak modundaki görünüm ayarları da buradadır.

import { api } from "../api.ts";
import { fileUrl } from "../editor/paths.ts";
import { t } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";
import { PALETTES, SCENE_LIST, sceneUrl, type WritingBg } from "./scenes.ts";

export function BackgroundPicker({ compact = false }: { compact?: boolean }) {
  const [bg, setBg] = usePref<WritingBg>("writingBg", { kind: "none" });
  const [everywhere, setEverywhere] = usePref<boolean>("writingBgEverywhere", false);
  const [hints, setHints] = usePref<boolean>("focusHints", true);
  const [typewriter, setTypewriter] = usePref<boolean>("focusTypewriter", false);
  const [dim, setDim] = usePref<boolean>("focusDim", false);
  const [width, setWidth] = usePref<number>("focusWidth", 720);
  const [fixedWidth, setFixedWidth] = usePref<boolean>("focusFixedWidth", false);

  const pickImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const { path } = await api.upload(f);
      setBg({ kind: "image", path });
    };
    input.click();
  };

  const is = (k: WritingBg["kind"], id?: string) => bg.kind === k && (id === undefined || ("id" in bg && bg.id === id));

  return (
    <div className={`bg-picker ${compact ? "compact" : ""}`}>
      {!compact && <p className="muted small">{t("focus.bgHint")}</p>}
      <div className="bg-section-title">{t("focus.scenes")}</div>
      <div className="bg-grid">
        <button className={`bg-tile none ${is("none") ? "on" : ""}`} onClick={() => setBg({ kind: "none" })} title={t("focus.none")}>
          ∅
        </button>
        {SCENE_LIST.map((s) => (
          <button key={s.id} className={`bg-tile ${is("scene", s.id) ? "on" : ""}`} style={{ background: `${sceneUrl(s.id)} center / cover` }} onClick={() => setBg({ kind: "scene", id: s.id })} title={t(s.label)}>
            <span>{t(s.label)}</span>
          </button>
        ))}
      </div>
      <div className="bg-section-title">{t("focus.palettes")}</div>
      <div className="bg-grid palettes">
        {PALETTES.map((p) => (
          <button key={p.id} className={`bg-tile palette ${is("palette", p.id) ? "on" : ""}`} style={{ background: p.bg, color: p.fg }} onClick={() => setBg({ kind: "palette", id: p.id })} title={t(p.label)}>
            <span>Aa</span>
          </button>
        ))}
        <label className={`bg-tile palette ${is("color") ? "on" : ""}`} title={t("focus.custom")} style={bg.kind === "color" ? { background: bg.value } : undefined}>
          <input type="color" value={bg.kind === "color" ? bg.value : "#1e2a38"} onChange={(e) => setBg({ kind: "color", value: e.target.value })} />
          <span>🎨</span>
        </label>
        <button className={`bg-tile palette ${is("image") ? "on" : ""}`} onClick={pickImage} title={t("focus.image")} style={bg.kind === "image" ? { background: `url("${fileUrl(bg.path)}") center / cover` } : undefined}>
          <span>🖼</span>
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} /> {t("focus.everywhere")}
      </label>
      <label className="check">
        <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} /> {t("focus.hints")}
      </label>
      <label className="check">
        <input type="checkbox" checked={typewriter} onChange={(e) => setTypewriter(e.target.checked)} /> {t("focus.typewriter")}
      </label>
      <label className="check">
        <input type="checkbox" checked={dim} onChange={(e) => setDim(e.target.checked)} /> {t("focus.dim")}
      </label>
      <label className="check">
        <input type="checkbox" checked={fixedWidth} onChange={(e) => setFixedWidth(e.target.checked)} /> {t("focus.fixedWidth")}
      </label>
      {fixedWidth && (
        <label className="field inline">
          <span>
            {t("focus.width")} · {width}px
          </span>
          <input type="range" min={520} max={1100} step={20} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
      )}
    </div>
  );
}
