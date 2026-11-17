// Boş ekran: ortalanmış simge, kısa açıklama ve isteğe bağlı tek bir eylem. Çöp, Ekler, listeler ve Shadow kullanır.

import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export function EmptyState({ icon, text, action, compact = false }: { icon: IconName; text: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <span className="empty-state-icon">
        <Icon name={icon} size={compact ? 18 : 24} />
      </span>
      <p>{text}</p>
      {action}
    </div>
  );
}
