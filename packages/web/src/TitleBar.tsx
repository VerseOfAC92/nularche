// macOS masaüstü penceresinde başlık çubuğunu arayüz çizer: böylece seçilen arka plana (ya da arka plan yoksa
// uygulamanın temasına) uyar. Trafik ışıkları işletim sisteminindir; çubuk pencereyi sürüklemeye yarar.
// Tam ekranda çubuk gizlenir. Windows/Linux'ta yerel çerçeve korunur (menü çubuğu orada durur).

import { useEffect, useState } from "react";
import { desktop } from "./desktop.ts";

const MAC_FRAME = desktop?.platform === "darwin";

export function TitleBar() {
  const [full, setFull] = useState(false);
  useEffect(() => desktop?.onFullScreen?.(setFull), []);
  const shown = MAC_FRAME && !full;
  useEffect(() => {
    const root = document.documentElement;
    if (shown) root.dataset.frame = "mac";
    else delete root.dataset.frame;
  }, [shown]);
  if (!shown) return null;
  return (
    <div className="titlebar" aria-hidden="true">
      Nularche
    </div>
  );
}
