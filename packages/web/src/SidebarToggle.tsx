// Kenar çubuğunu gizleme/gösterme düğmesi. macOS'ta başlık çubuğunda pencere düğmelerinin yanında durur;
// Windows ve Linux'ta pencerenin sol üst köşesinde. Kenar çubuğu gizliyken üzerine gelmek onu açılır panel
// olarak gösterir; tıklamak kalıcı olarak açar ya da gizler.

import { t } from "./i18n/index.ts";
import { usePref } from "./prefs.ts";
import { keys } from "./shortcuts.tsx";
import { peekClose, peekEnter, peekLeave } from "./sidebarPeek.ts";

export function SidebarToggle({ floating }: { floating?: boolean }) {
  const [hidden, setHidden] = usePref<boolean>("sidebarMini", false);
  const label = t(hidden ? "ws.expandSidebar" : "ws.collapseSidebar");
  // Köşedeki düğme yalnızca kenar çubuğu gizliyken gerekir; açıkken düğme kenar çubuğunun başlığındadır.
  if (floating && !hidden) return null;
  return (
    <button
      className={`sidebar-toggle ${floating ? "floating" : ""} ${hidden ? "is-hidden" : ""}`}
      title={`${label} (${keys("Mod+Alt+B")})`}
      aria-label={label}
      aria-pressed={!hidden}
      onClick={() => (peekClose(), setHidden(!hidden))}
      onMouseEnter={() => hidden && peekEnter()}
      onMouseLeave={() => hidden && peekLeave()}
    >
      <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
        <rect x="0.75" y="0.75" width="16.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="6.5" y1="1" x2="6.5" y2="13" stroke="currentColor" strokeWidth="1.5" />
        {!hidden && <rect x="1.5" y="1.5" width="4.5" height="11" rx="1.5" fill="currentColor" opacity="0.35" />}
      </svg>
    </button>
  );
}
