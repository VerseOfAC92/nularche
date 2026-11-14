// Sayfa yazı tipi ve boyutu (Writer'daki ⌘T yazı tipi paneli karşılığı). Ayar sayfanın frontmatter'ına yazılır.

import { t } from "../i18n/index.ts";
import { BUNDLED_FONTS } from "../studio/fonts.ts";

import { DEFAULT_FONT_SIZE, fontStack, SYSTEM_FONTS } from "./font-stack.ts";

export function FontDialog({ font, size, onChange, onClose }: { font?: string; size?: number; onChange: (font: string | null, size: number | null) => void; onClose: () => void }) {
  const current = size ?? DEFAULT_FONT_SIZE;
  return (
    <div className="overlay" onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog small-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t("font.title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </header>
        <label className="field">
          <span>{t("font.family")}</span>
          <select autoFocus value={font ?? ""} onChange={(e) => onChange(e.target.value || null, size ?? null)}>
            <option value="">{t("font.default")}</option>
            <option value="serif">{t("font.serif")}</option>
            <option value="sans">{t("font.sans")}</option>
            <option value="mono">{t("font.mono")}</option>
            <optgroup label={t("ws.bundledFonts")}>
              {BUNDLED_FONTS.map((f) => (
                <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                  {f.family}
                </option>
              ))}
            </optgroup>
            <optgroup label="—">
              {SYSTEM_FONTS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="field">
          <span>
            {t("font.size")} · {current}px
          </span>
          <input type="range" min={12} max={32} value={current} onChange={(e) => onChange(font ?? null, Number(e.target.value) === DEFAULT_FONT_SIZE ? null : Number(e.target.value))} />
        </label>
        <p className="font-preview" style={{ fontFamily: fontStack(font), fontSize: current }}>
          {t("font.preview")}
        </p>
        <div className="dialog-actions">
          <button className="secondary" onClick={() => onChange(null, null)}>
            {t("font.reset")}
          </button>
          <span className="grow" />
          <button className="primary" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
