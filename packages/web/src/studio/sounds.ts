// Daktilo sesleri ve ortam sesleri (2.0). Hiçbir ses dosyası yoktur: her ses Web Audio ile anında üretilir
// (tuş vuruşu, satır başı, kenar zili; yağmur, saat, yaz gecesi, şömine). Ağ bağlantısı gerekmez.

export type TypeProfile = "light" | "heavy";
export type Ambience = "off" | "rain" | "clock" | "night" | "fire";
export const AMBIENCES: Ambience[] = ["off", "rain", "clock", "night", "fire"];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, out: master! };
  } catch {
    return null;
  }
}

let noiseCache: AudioBuffer | null = null;
/** 2 saniyelik beyaz gürültü (tekrar kullanılır). */
function noise(c: AudioContext): AudioBuffer {
  if (noiseCache && noiseCache.sampleRate === c.sampleRate) return noiseCache;
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache = buf;
  return buf;
}

let brownCache: AudioBuffer | null = null;
/** Kahverengi gürültü (yumuşak, derin): yağmur ve şömine için. */
function brown(c: AudioContext): AudioBuffer {
  if (brownCache && brownCache.sampleRate === c.sampleRate) return brownCache;
  const buf = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  brownCache = buf;
  return buf;
}

/** Kısa, süzülmüş bir gürültü patlaması. */
function burst(c: AudioContext, out: AudioNode, opts: { at?: number; dur: number; freq: number; q?: number; gain: number; type?: BiquadFilterType }): void {
  const t = opts.at ?? c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.frequency.value = opts.freq;
  f.Q.value = opts.q ?? 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5, opts.dur + 0.02);
}

function tone(c: AudioContext, out: AudioNode, opts: { at?: number; freq: number; dur: number; gain: number; type?: OscillatorType }): void {
  const t = opts.at ?? c.currentTime;
  const o = c.createOscillator();
  o.type = opts.type ?? "sine";
  o.frequency.value = opts.freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + opts.dur + 0.05);
}

/** Tuş sesi. `volume` 0–1. */
export function typeSound(kind: "key" | "space" | "back" | "return", volume: number, profile: TypeProfile = "light"): void {
  const a = audio();
  if (!a || volume <= 0) return;
  const { ctx: c, out } = a;
  const v = Math.min(1, volume);
  const jitter = 0.85 + Math.random() * 0.3;
  const heavy = profile === "heavy";
  if (kind === "return") {
    // Satır başı kolu: mandal tıkırtıları ve sürgü sesi.
    for (let i = 0; i < 6; i++) burst(c, out, { at: c.currentTime + i * 0.035, dur: 0.02, freq: 2600 + i * 120, q: 4, gain: 0.25 * v });
    burst(c, out, { at: c.currentTime + 0.05, dur: 0.32, freq: 900, q: 0.6, gain: 0.18 * v, type: "lowpass" });
    burst(c, out, { at: c.currentTime + 0.36, dur: 0.06, freq: 300, q: 1, gain: 0.5 * v, type: "lowpass" });
    return;
  }
  const freq = kind === "space" ? 1300 : kind === "back" ? 1800 : 3000 * jitter;
  burst(c, out, { dur: heavy ? 0.05 : 0.035, freq, q: 1.5, gain: (kind === "back" ? 0.25 : 0.45) * v * jitter });
  // Kâğıda vuran harf kolu: alçak bir gümbürtü (ağır makinede daha belirgin).
  tone(c, out, { freq: heavy ? 95 : 150, dur: heavy ? 0.07 : 0.045, gain: (heavy ? 0.4 : 0.18) * v, type: "triangle" });
}

/** Kenar zili. */
export function bell(volume: number): void {
  const a = audio();
  if (!a || volume <= 0) return;
  const v = Math.min(1, volume);
  tone(a.ctx, a.out, { freq: 2350, dur: 1.4, gain: 0.22 * v });
  tone(a.ctx, a.out, { freq: 3525, dur: 0.9, gain: 0.08 * v });
  tone(a.ctx, a.out, { freq: 5870, dur: 0.4, gain: 0.03 * v });
}

/** Zamanlayıcı bitince çalan yumuşak çan. */
export function chime(volume = 0.6): void {
  const a = audio();
  if (!a) return;
  [660, 880, 1320].forEach((f, i) => tone(a.ctx, a.out, { at: a.ctx.currentTime + i * 0.18, freq: f, dur: 1.2, gain: 0.18 * volume }));
}

// ------------------------------------------------------------------ Ortam sesleri

let ambience: { kind: Ambience; stop: () => void; gain: GainNode } | null = null;

export function currentAmbience(): Ambience {
  return ambience?.kind ?? "off";
}

/** Ortam sesini başlatır (`off` durdurur). `level` 0–1. */
export function setAmbience(kind: Ambience, level: number): void {
  if (ambience && ambience.kind === kind) {
    ambience.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.6, ambience.gain.context.currentTime, 0.3);
    return;
  }
  ambience?.stop();
  ambience = null;
  if (kind === "off") return;
  const a = audio();
  if (!a) return;
  const { ctx: c, out } = a;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.6, c.currentTime, 0.8);
  gain.connect(out);
  const sources: AudioScheduledSourceNode[] = [];
  /** Zamanlanmış her olay türü için tek bir zamanlayıcı (dizi uzun oturumlarda büyümesin). */
  const timers = new Map<number, number>();
  let nextTimer = 0;
  const loop = (buf: AudioBuffer, filter: { type: BiquadFilterType; freq: number; q?: number }, g: number) => {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    f.Q.value = filter.q ?? 0.7;
    const gg = c.createGain();
    gg.gain.value = g;
    s.connect(f).connect(gg).connect(gain);
    s.start();
    sources.push(s);
  };
  const every = (ms: () => number, fn: () => void) => {
    const key = nextTimer++;
    const tick = () => {
      fn();
      timers.set(key, window.setTimeout(tick, ms()));
    };
    timers.set(key, window.setTimeout(tick, ms()));
  };
  if (kind === "rain") {
    loop(brown(c), { type: "lowpass", freq: 1400 }, 0.9);
    loop(noise(c), { type: "highpass", freq: 6000 }, 0.04);
    every(() => 40 + Math.random() * 160, () => burst(c, gain, { dur: 0.015 + Math.random() * 0.02, freq: 2500 + Math.random() * 4000, q: 3, gain: 0.05 + Math.random() * 0.12 }));
  } else if (kind === "fire") {
    loop(brown(c), { type: "lowpass", freq: 500 }, 1.1);
    every(() => 60 + Math.random() * 500, () => burst(c, gain, { dur: 0.008 + Math.random() * 0.03, freq: 1500 + Math.random() * 5000, q: 2, gain: 0.08 + Math.random() * 0.3, type: "highpass" }));
  } else if (kind === "clock") {
    let tock = false;
    every(
      () => 1000,
      () => {
        tock = !tock;
        burst(c, gain, { dur: 0.03, freq: tock ? 1700 : 2300, q: 6, gain: 0.6 });
        tone(c, gain, { freq: tock ? 800 : 1000, dur: 0.05, gain: 0.08 });
      },
    );
  } else if (kind === "night") {
    loop(brown(c), { type: "lowpass", freq: 350 }, 0.5);
    every(
      () => 700 + Math.random() * 900,
      () => {
        const base = 4200 + Math.random() * 600;
        for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) tone(c, gain, { at: c.currentTime + i * 0.055, freq: base, dur: 0.035, gain: 0.05, type: "square" });
      },
    );
  }
  ambience = {
    kind,
    gain,
    stop: () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      gain.gain.setTargetAtTime(0, c.currentTime, 0.3);
      window.setTimeout(() => {
        for (const s of sources) s.stop();
        gain.disconnect();
      }, 1200);
    },
  };
}
