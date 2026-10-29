// Odak modu ("Odaklan. Yaz."): kenar çubuğu ve araçlar gizlenir; fare hareket edince üst ve alt bilgi çubukları
// belirir, durunca kaybolur. Esc ile çıkılır. Arka plan seçici üst çubuktan açılır.

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";
import { keys } from "../shortcuts.tsx";
import { BackgroundPicker } from "./BackgroundPicker.tsx";

export function FocusHud({ onExit }: { onExit: () => void }) {
  const [visible, setVisible] = useState(true);
  const [picker, setPicker] = useState(false);
  const [hints] = usePref<boolean>("focusHints", true);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const reveal = () => {
      setVisible(true);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setVisible(false), 2500);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".overlay, .pop.suggest, .find-bar")) {
        e.preventDefault();
        onExit();
      }
    };
    reveal();
    addEventListener("mousemove", reveal);
    addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer.current);
      removeEventListener("mousemove", reveal);
      removeEventListener("keydown", onKey);
    };
  }, [onExit]);

  const show = visible || picker;
  return (
    <>
      <div className={`focus-hud top ${show ? "show" : ""}`}>
        <span className="focus-tagline">{t("focus.tagline")}</span>
        <span className="grow" />
        <button className="focus-btn" onClick={() => setPicker((v) => !v)} title={t("focus.background")}>
          🏞 {t("focus.background")}
        </button>
        <button className="focus-btn" onClick={onExit} title={t("focus.exit")}>
          ✕
        </button>
      </div>
      {picker && (
        <div className="focus-picker" onMouseLeave={() => setPicker(false)}>
          <BackgroundPicker compact />
        </div>
      )}
      {hints && (
        <div className={`focus-hud bottom ${show ? "show" : ""}`}>
          {t("focus.hintBar", {
            link: keys("Mod+L"),
            bold: keys("Mod+B"),
            italic: keys("Mod+I"),
            underline: keys("Mod+U"),
            font: keys("Mod+T"),
            new: keys("Mod+N"),
          })}
        </div>
      )}
    </>
  );
}
