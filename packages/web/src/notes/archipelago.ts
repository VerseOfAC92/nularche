// Archipelago: Arche'leri kenar çubuğunda bir arada gösteren grup (Arche'ler adalar, Archipelago onların takımadası).
// Yalnızca görünümü düzenler: dosyalar taşınmaz, Arche'ler Origin kökünde kalır. Tanımlar Origin tercihlerinde
// (`archipelagos`) saklanır. Bir Arche en fazla bir Archipelago'dadır; şu an kökte olmayan (çöpe atılmış ya da başka
// bir Node'un altına taşınmış) Arche'lerin kimlikleri silinmez, Arche köke dönünce grubunda yeniden görünür.

import type { NodeMeta } from "../api.ts";

export interface Archipelago {
  id: string;
  name: string;
  icon?: string;
  /** Gruptaki Arche'lerin sırası. */
  archeIds: string[];
}

export const newArchipelagoId = () => `ap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface ResolvedArchipelagos {
  groups: { group: Archipelago; arches: NodeMeta[] }[];
  /** Hiçbir gruba girmeyen Arche'ler (kök sırasıyla). */
  loose: NodeMeta[];
}

/** Grupları kökteki gerçek Arche'lerle eşler; aynı Arche birden çok grupta kayıtlıysa ilk grupta gösterilir. */
export function resolveArchipelagos(groups: Archipelago[], arches: NodeMeta[]): ResolvedArchipelagos {
  const byId = new Map(arches.map((a) => [a.id, a]));
  const taken = new Set<string>();
  const out = groups.map((group) => ({
    group,
    arches: group.archeIds.flatMap((id) => {
      const a = byId.get(id);
      if (!a || taken.has(id)) return [];
      taken.add(id);
      return [a];
    }),
  }));
  return { groups: out, loose: arches.filter((a) => !taken.has(a.id)) };
}

/** Bir Arche'yi verilen Archipelago'ya taşır (null: gruptan çıkarır). `near` verilirse o Arche'nin önüne/arkasına konur. */
export function assignArche(
  groups: Archipelago[],
  archeId: string,
  groupId: string | null,
  near?: { id: string; after: boolean },
): Archipelago[] {
  return groups.map((g) => {
    const rest = g.archeIds.filter((id) => id !== archeId);
    if (g.id !== groupId) return rest.length === g.archeIds.length ? g : { ...g, archeIds: rest };
    const at = near ? rest.indexOf(near.id) : -1;
    const ids = [...rest];
    if (at < 0) ids.push(archeId);
    else ids.splice(at + (near!.after ? 1 : 0), 0, archeId);
    return { ...g, archeIds: ids };
  });
}

/** Arche'nin kayıtlı olduğu Archipelago (yoksa undefined). */
export const groupOf = (groups: Archipelago[], archeId: string) => groups.find((g) => g.archeIds.includes(archeId));
