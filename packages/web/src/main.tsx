import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { useLang } from "./i18n/index.ts";
import { applyTheme } from "./theme.ts";
import "./styles.css";

applyTheme();

/** Dil değişince tüm arayüz yeni dilde yeniden çizilir; açık pencereler ve düzenleme durumu korunur. */
function Root() {
  useLang();
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
