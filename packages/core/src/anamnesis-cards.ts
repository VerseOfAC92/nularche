// Anamnesis kartlarını not metninden çıkarma (saf işlevler; şifreli notların kartları pencerede çözülüp burada
// ayrıştırılır). Kart kimliği, `cardKeyInput` metninin SHA-256 özetinin ilk 20 onaltılık hanesidir: sunucu ve
// pencere aynı kimliği üretir.

import { isLockedBody, maskCode } from "./note-text.ts";

export interface RawCard {
  front: string;
  back: string;
  line: number;
  dir: "f" | "r";
}

export const cardKeyInput = (noteId: string, front: string, dir: string) => `${noteId}\0${front.trim().toLocaleLowerCase("tr")}\0${dir}`;

export function extractRawCards(body: string): RawCard[] {
  if (isLockedBody(body)) return [];
  const out: RawCard[] = [];
  const masked = maskCode(body).split("\n");
  const lines = body.split("\n");
  masked.forEach((m, i) => {
    const hit = /^(.*?\S)\s+(:{2,3})\s+(\S.*)$/.exec(m);
    if (!hit) return;
    // Liste işareti ve görev kutusu karta dahil edilmez.
    const raw = lines[i];
    const sep = /\s+:{2,3}\s+/.exec(m.slice(hit[1].length))!;
    const end = hit[1].length + sep.index + sep[0].length;
    const front = raw.slice(0, hit[1].length).replace(/^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]+\[.\])?[ \t]+/, "").replace(/^#{1,6}\s+/, "").trim();
    const back = raw.slice(end).replace(/[ \t]\^[\w-]+$/, "").trim();
    if (!front || !back) return;
    out.push({ front, back, line: i, dir: "f" });
    if (hit[2] === ":::") out.push({ front: back, back: front, line: i, dir: "r" });
  });
  return out;
}
