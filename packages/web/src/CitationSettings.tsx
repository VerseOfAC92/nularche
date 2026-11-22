// Ayarlar → Yazma → Fontes (kaynakça): kaynak dosyaları (.bib / CSL-JSON) ve atıf stili. Atıflar notlarda
// `[@anahtar]` ile yapılır; dışa aktarmada (HTML, Word, site, Codex) seçilen stille biçimlenir ve kaynakça eklenir.

import { useEffect, useRef, useState } from "react";
import { CITATION_STYLES, type CitationStyle } from "../../core/src/citations.ts";
import { api, errorMessage } from "./api.ts";
import { reloadCitations, useCitations } from "./citations.ts";
import { t } from "./i18n/index.ts";
import { setPref } from "./prefs.ts";
import { Icon } from "./ui/Icon.tsx";

const STYLE_LABEL: Record<CitationStyle, string> = { apa: "APA 7", chicago: "Chicago", mla: "MLA 9", ieee: "IEEE" };

export function CitationSettings({ onToast }: { onToast: (msg: string) => void }) {
  const lib = useCitations();
  const [pick, setPick] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => void reloadCitations(), []);

  const save = async (files: string[], style = lib.style) => {
    setPref("citationFiles", files.length ? files : null);
    setPref("citationStyle", style);
    // Tercihler kısa bir gecikmeyle yazılır; sunucudan okumadan önce doğrudan kaydet.
    await api.setPrefs({ citationFiles: files.length ? files : null, citationStyle: style });
    await reloadCitations();
  };

  const candidates = lib.available.filter((f) => !lib.files.includes(f));
  return (
    <section className="settings-card">
      <h4>{t("cite.title")}</h4>
      <p className="muted small">{t("cite.hint")}</p>
      {lib.files.map((f) => (
        <div key={f} className="row" data-testid="cite-file">
          <Icon name="books" size={16} />
          <code className="grow path">{f}</code>
          <button className="icon-btn" title={t("cite.remove")} onClick={() => void save(lib.files.filter((x) => x !== f))}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
      <p className="muted small" data-testid="cite-count">
        {lib.files.length ? t("cite.count", { n: lib.items.size }) : t("cite.none")}
      </p>
      {lib.problems.map((p, i) => (
        <p key={i} className="error-text small">
          {p.file}: {p.message}
        </p>
      ))}
      <div className="row">
        {candidates.length > 0 && (
          <select value={pick} onChange={(e) => (setPick(""), e.target.value && void save([...lib.files, e.target.value]))} data-testid="cite-pick">
            <option value="">{t("cite.pick")}</option>
            {candidates.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        <button className="secondary" onClick={() => input.current?.click()}>
          <Icon name="upload" size={14} /> {t("cite.import")}
        </button>
        <input
          ref={input}
          type="file"
          accept=".bib,.json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              const { path } = await api.upload(file);
              await save([...lib.files, path]);
              onToast(t("cite.imported", { name: file.name }));
            } catch (err) {
              onToast(errorMessage(err));
            }
          }}
        />
      </div>
      <h4 className="sub">{t("cite.style")}</h4>
      <div className="segmented">
        {CITATION_STYLES.map((s) => (
          <button key={s} className={lib.style === s ? "on" : ""} onClick={() => void save(lib.files, s)}>
            {STYLE_LABEL[s]}
          </button>
        ))}
      </div>
    </section>
  );
}
