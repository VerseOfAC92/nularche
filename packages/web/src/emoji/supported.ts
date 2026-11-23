// Bir emojiyi işletim sisteminin yazı tipleri tek, renkli bir karakter olarak çizebiliyor mu? Çizemediği emojiler
// boş kutu, siyah-beyaz yedek karakter ya da yan yana birkaç parça (desteklenmeyen birleşik dizi, ör. yeni bir
// ZWJ emojisi ya da bayrak yerine iki harf) olarak görünür. Bu yüzden seçici yalnızca burada geçen emojileri gösterir.
// Ölçüm küçük bir tuvalde yapılır, sonucu yalnızca bu oturumun belleğinde tutulur.

const SIZE = 24;
const FONT = `${SIZE - 4}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif`;

let ctx: CanvasRenderingContext2D | null | undefined;
let reference = 0;
const cache = new Map<string, boolean>();

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE * 2;
    canvas.height = SIZE;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.font = FONT;
      ctx.textBaseline = "top";
      reference = ctx.measureText("😀").width;
    }
  } catch {
    ctx = null;
  }
  // Ölçüm yapılamıyorsa (ör. tuval yok) karar verilemez: hepsi gösterilir.
  if (ctx && !(reference > 0)) ctx = null;
  return ctx ?? null;
}

/** Emoji tek ve renkli bir karakter olarak çizilebiliyorsa true; ölçüm yapılamıyorsa da true. */
export function isEmojiSupported(emoji: string): boolean {
  const hit = cache.get(emoji);
  if (hit !== undefined) return hit;
  const c = context();
  if (!c) return true;
  // Birden çok parçaya bölünen dizi (desteklenmeyen birleşik emoji) daha geniş çizilir.
  let ok = c.measureText(emoji).width <= reference * 1.4;
  if (ok) {
    c.clearRect(0, 0, SIZE * 2, SIZE);
    c.fillStyle = "#000";
    c.fillText(emoji, 0, 0);
    const px = c.getImageData(0, 0, SIZE * 2, SIZE).data;
    // Renkli piksel var mı: yedek (kutu ya da siyah-beyaz) çizimler yalnızca gri tonludur.
    ok = false;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 40 && (Math.abs(px[i] - px[i + 1]) > 16 || Math.abs(px[i + 1] - px[i + 2]) > 16)) {
        ok = true;
        break;
      }
    }
  }
  cache.set(emoji, ok);
  return ok;
}

/**
 * Listedeki desteklenen emojiler. Sistem renkli emoji çizemiyorsa (ör. renkli emoji yazı tipi olmayan bir Linux)
 * ölçüm güvenilmez olur: o durumda liste olduğu gibi döner.
 */
export function supportedOnly<T>(items: T[], emojiOf: (item: T) => string): T[] {
  if (!context()) return items;
  const kept = items.filter((x) => isEmojiSupported(emojiOf(x)));
  return kept.length >= items.length * 0.25 ? kept : items;
}
