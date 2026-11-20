// Lectern adresleri: `#lectern:<kodlanmış yol>@<sayfa>,<vurgu>` (yol kodlu olduğundan @ ve , yolda geçemez).

export function lecternHash(path: string, page?: number, hl?: string): string {
  return `lectern:${encodeURIComponent(path)}${page ? `@${page}` : ""}${hl ? `,${hl}` : ""}`;
}

export function parseLecternHash(hash: string): { path: string; page?: number; hl?: string } | null {
  const m = /^#?lectern:([^@,]+)(?:@(\d+))?(?:,([\w-]+))?$/.exec(hash);
  if (!m) return null;
  try {
    return { path: decodeURIComponent(m[1]), ...(m[2] ? { page: Number(m[2]) } : {}), ...(m[3] ? { hl: m[3] } : {}) };
  } catch {
    return null;
  }
}
