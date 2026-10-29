// Matematik sonuçları (Apple Notlar'daki Math Notes karşılığı): satır sonundaki `=` işaretinden önceki ifadeyi hesaplar.
// Küçük ve güvenli bir ayrıştırıcıdır: yalnızca sayılar, değişkenler, + − × ÷ ^ % ve birkaç fonksiyon; kod çalıştırmaz.

export type Vars = Map<string, number>;

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  karekok: Math.sqrt,
  abs: Math.abs,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
};
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

const IDENT = /^[\p{L}_][\p{L}\p{N}_]*/u;

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) {
      i += ws[0].length;
      continue;
    }
    const num = /^(\d+(?:[.,]\d+)?|[.,]\d+)/.exec(rest);
    if (num) {
      out.push({ t: "num", v: Number(num[0].replace(",", ".")) });
      i += num[0].length;
      continue;
    }
    const id = IDENT.exec(rest);
    // "3 x 4": sayılar arasındaki x çarpma işaretidir.
    const prev = out[out.length - 1];
    if (id && id[0] === "x" && prev && (prev.t === "num" || (prev.t === "op" && prev.v === ")")) && /^x\s*[\d(]/.test(rest)) {
      out.push({ t: "op", v: "*" });
      i++;
      continue;
    }
    if (id) {
      out.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const ch = rest[0];
    const op = ({ "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-" } as Record<string, string>)[ch] ?? ch;
    if (!"+-*/^%(),".includes(op)) return null;
    out.push({ t: "op", v: op });
    i++;
  }
  return out;
}

/** İfadeyi hesaplar; geçersizse ya da sonuç sonlu değilse null. */
export function evaluate(expr: string, vars: Vars = new Map()): number | null {
  const toks = tokenize(expr);
  if (!toks || toks.length === 0) return null;
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const fail = (): never => {
    throw new Error("parse");
  };

  const primary = (): number => {
    const tk = toks[p++];
    if (!tk) return fail();
    if (tk.t === "num") return tk.v;
    if (tk.t === "op" && tk.v === "(") {
      const v = additive();
      if (!isOp(")")) fail();
      p++;
      return v;
    }
    if (tk.t === "op" && (tk.v === "-" || tk.v === "+")) {
      const v = power();
      return tk.v === "-" ? -v : v;
    }
    if (tk.t === "id") {
      const name = tk.v.toLocaleLowerCase("tr");
      const fn = FUNCS[name.replace(/ö/g, "o").replace(/ü/g, "u")];
      if (fn && isOp("(")) {
        p++;
        const args: number[] = [];
        if (!isOp(")")) {
          args.push(additive());
          while (isOp(",")) {
            p++;
            args.push(additive());
          }
        }
        if (!isOp(")")) fail();
        p++;
        return fn(...args);
      }
      if (vars.has(name)) return vars.get(name)!;
      if (name in CONSTS) return CONSTS[name];
    }
    return fail();
  };

  const postfix = (): number => {
    let v = primary();
    while (isOp("%")) {
      p++;
      v /= 100;
    }
    return v;
  };

  const power = (): number => {
    const base = postfix();
    if (isOp("^")) {
      p++;
      return base ** power();
    }
    return base;
  };

  const multiplicative = (): number => {
    let v = power();
    for (;;) {
      if (isOp("*")) (p++, (v *= power()));
      else if (isOp("/")) (p++, (v /= power()));
      else if (peek()?.t === "num" || peek()?.t === "id" || isOp("(")) v *= power(); // 2(3+4), 2pi
      else return v;
    }
  };

  const additive = (): number => {
    let v = multiplicative();
    for (;;) {
      if (isOp("+") || isOp("-")) {
        const op = toks[p++].v;
        // "200 + 10%" → 220 (Notlar ve hesap makineleri gibi yüzde artış)
        const start = p;
        const rhs = multiplicative();
        const pct = toks[p - 1]?.t === "op" && toks[p - 1].v === "%" && p - start === 2;
        const delta = pct ? v * rhs : rhs;
        v = op === "+" ? v + delta : v - delta;
      } else return v;
    }
  };

  try {
    const v = additive();
    if (p !== toks.length || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

/** Sonucu ifadedeki ondalık ayırıcıyla, en çok 10 anlamlı basamakla biçimlendirir. */
export function formatResult(v: number, sample: string, defaultComma = false): string {
  const rounded = Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-9 && v !== 0) ? v.toPrecision(10) : String(Number(v.toPrecision(12)));
  const comma = /\d,\d/.test(sample) ? true : /\d\.\d/.test(sample) ? false : defaultComma;
  return comma ? rounded.replace(".", ",") : rounded;
}

const ASSIGN = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*=\s*([^=]+?)\s*$/u;

/** Bir satır `ad = ifade` biçiminde bir değişken tanımıysa değişkene yazar. */
export function readAssignment(line: string, vars: Vars): void {
  const m = ASSIGN.exec(line);
  if (!m) return;
  const v = evaluate(m[2], vars);
  if (v !== null) vars.set(m[1].toLocaleLowerCase("tr"), v);
}

/**
 * Satır `ifade =` ile bitiyorsa ve ifade hesaplanabiliyorsa sonucu döndürür. Tek başına bir sayı (`5 =`) ya da
 * hesap içermeyen bir ad sonuç vermez; böylece sıradan metinlerdeki `=` işaretleri yanlış tetiklenmez.
 */
export function lineResult(line: string, vars: Vars, defaultComma = false): string | null {
  const m = /^(.*?)=\s*$/.exec(line);
  if (!m) return null;
  // Satırın başındaki "Toplam:" gibi bir etiketi atla: son ':' sonrasını ifade say.
  let expr = m[1];
  const label = /^[^\d(=]*?:\s*(.+)$/u.exec(expr);
  if (label && evaluate(label[1], vars) !== null) expr = label[1];
  if (!expr.trim() || /=/.test(expr)) return null;
  const toks = tokenize(expr);
  if (!toks || toks.length < 2 && !(toks[0]?.t === "id" && vars.has(toks[0].v.toLocaleLowerCase("tr")))) return null;
  const v = evaluate(expr, vars);
  return v === null ? null : formatResult(v, expr, defaultComma);
}
