// macOS masaüstü penceresinde başlık çubuğunu arayüz çizer: böylece seçilen arka plana (ya da arka plan yoksa
// uygulamanın temasına) uyar. Trafik ışıkları işletim sisteminindir; çubuk pencereyi sürüklemeye yarar.
// Tam ekranda çubuk gizlenir. Windows/Linux'ta yerel çerçeve korunur (menü çubuğu orada durur).

import { useEffect, useState } from "react";
import { desktop } from "./desktop.ts";
import { SidebarToggle } from "./SidebarToggle.tsx";

export const MAC_FRAME = desktop?.platform === "darwin";

export function TitleBar({ sidebarToggle = true }: { sidebarToggle?: boolean }) {
  const [full, setFull] = useState(false);
  useEffect(() => desktop?.onFullScreen?.(setFull), []);
  const shown = MAC_FRAME && !full;
  useEffect(() => {
    const root = document.documentElement;
    if (shown) root.dataset.frame = "mac";
    else delete root.dataset.frame;
  }, [shown]);
  // Tam ekranda (ya da başlık çubuğu yokken) düğme pencerenin sol üst köşesinde durur.
  if (!shown) return sidebarToggle ? <SidebarToggle floating /> : null;
  return (
    <div className="titlebar">
      {sidebarToggle && <SidebarToggle />}
      <span aria-hidden="true">Nularche</span>
    </div>
  );
}
