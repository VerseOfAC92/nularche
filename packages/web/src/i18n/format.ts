// Metin şablonunu doldurur: "{n}" yerine değer; "{n:note|notes}" tekil/çoğul seçimi (n === 1 ise ilk biçim).

export function format(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  s = s.replace(/\{(\w+):([^|}]*)\|([^}]*)\}/g, (_, k: string, one: string, many: string) => (Number(vars[k]) === 1 ? one : many));
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
