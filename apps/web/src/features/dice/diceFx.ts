import type { RollResult } from "@vtt/rules";

export const MAX_SHOWN_DICE = 12;
export const TUMBLE_MS = 750;
export const HOLD_MS = 2200;

export interface ShownDie {
  sides: number;
  value: number;
  dropped: boolean;
  /** Max/min face on a d20 test, for colour. */
  tone: "crit" | "fumble" | "normal";
}

/** Dice to draw for a roll (first {@link MAX_SHOWN_DICE}); the rest are summarised as "+N". */
export function diceToShow(result: RollResult | undefined): { dice: ShownDie[]; hidden: number } {
  if (!result) return { dice: [], hidden: 0 };
  const all: ShownDie[] = [];
  for (const term of result.terms) {
    for (const d of term.dice) {
      const tone = term.sides === 20 && !d.dropped ? (d.value === 20 ? "crit" : d.value === 1 ? "fumble" : "normal") : "normal";
      all.push({ sides: term.sides, value: d.value, dropped: !!d.dropped, tone });
    }
  }
  return { dice: all.slice(0, MAX_SHOWN_DICE), hidden: Math.max(0, all.length - MAX_SHOWN_DICE) };
}

/** SVG polygon points (in a 0..100 box) suggesting each die's shape. */
export function dieShape(sides: number): string {
  const poly = (n: number, rot: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n;
      return `${(50 + 46 * Math.cos(a)).toFixed(1)},${(50 + 46 * Math.sin(a)).toFixed(1)}`;
    }).join(" ");
  switch (sides) {
    case 4:
      return poly(3, -Math.PI / 2);
    case 6:
      return "8,8 92,8 92,92 8,92";
    case 8:
      return poly(4, -Math.PI / 2);
    case 10:
    case 100:
      return poly(5, -Math.PI / 2);
    case 12:
      return poly(5, Math.PI / 2);
    default:
      return poly(6, -Math.PI / 2);
  }
}

/** Whether to animate, honouring the user's setting and the OS "reduce motion" preference. */
export function shouldAnimate(setting: boolean | undefined, reducedMotion: boolean): boolean {
  return setting !== false && !reducedMotion;
}

/** A short synthesized rattle (no audio files). Silently does nothing where Web Audio is unavailable. */
export function playRattle(dice: number) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const hits = Math.min(10, 3 + dice * 2);
    for (let i = 0; i < hits; i++) {
      const t = ctx.currentTime + (i / hits) * (TUMBLE_MS / 1000) * (0.6 + Math.random() * 0.4);
      const len = 0.03;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1) * (1 - j / data.length) ** 3;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1800 + Math.random() * 1800;
      const gain = ctx.createGain();
      gain.gain.value = 0.25 * (1 - i / hits) + 0.05;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(t);
    }
    setTimeout(() => void ctx.close().catch(() => {}), TUMBLE_MS + 500);
  } catch {
    /* audio blocked or unsupported */
  }
}
