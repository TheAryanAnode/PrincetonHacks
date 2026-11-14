import type { Instrument } from "../types";

/** Instruments that ring out on their own (like a struck bar or plucked string) instead of stopping on release. */
export const PERCUSSIVE: ReadonlySet<Instrument> = new Set(["marimba", "guitar"]);

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/**
 * Render one note of a synthesized instrument to mono samples (peak 0.9).
 * Rendered once per pitch and cached as an AudioBuffer by the audio engine, so playback is a plain
 * buffer start with the same latency and voice handling as the piano samples.
 */
export function renderNote(instrument: Exclude<Instrument, "piano">, midi: number, rate: number): Float32Array {
  const f = hz(midi);
  const seconds = { marimba: 1.4, guitar: 2.6, bass: 3, organ: 4, synth: 3 }[instrument];
  const out = new Float32Array(Math.round(seconds * rate));
  const attack = (t: number, s: number) => Math.min(1, t / s);
  // Sum of harmonics [multiple, level, decay/s], kept below Nyquist.
  const additive = (partials: [number, number, number][], attackS: number) => {
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      let v = 0;
      for (const [m, level, decay] of partials)
        if (f * m < rate / 2) v += level * Math.sin(2 * Math.PI * f * m * t) * Math.exp(-decay * t);
      out[i] = v * attack(t, attackS);
    }
  };
  switch (instrument) {
    case "marimba": // bright mallet hit: fundamental + fast-dying 4th and 10th partials
      additive([[1, 1, 4], [3.93, 0.35, 16], [9.2, 0.12, 40]], 0.002);
      break;
    case "bass": // round, low-passed saw
      additive(Array.from({ length: 8 }, (_, k) => [k + 1, 1 / (k + 1) ** 1.6, 0.8 + k * 0.5] as [number, number, number]), 0.006);
      break;
    case "organ": // drawbars, no decay while held
      additive([[1, 1, 0.05], [2, 0.6, 0.05], [3, 0.4, 0.05], [4, 0.25, 0.05], [6, 0.15, 0.05], [8, 0.1, 0.05]], 0.012);
      break;
    case "synth": { // two detuned saws
      const saw: [number, number, number][] = [];
      for (let k = 1; k <= 12; k++) saw.push([k * 1.004, 0.5 / k, 0.4 + k * 0.08], [k * 0.996, 0.5 / k, 0.4 + k * 0.08]);
      additive(saw, 0.01);
      break;
    }
    case "guitar": { // Karplus–Strong plucked string
      const period = Math.max(2, Math.round(rate / f));
      const ring = new Float32Array(period);
      let seed = midi * 7919 + 1; // deterministic noise, so a note always sounds the same
      for (let i = 0; i < period; i++) {
        seed = (seed * 16807) % 2147483647;
        ring[i] = (seed / 2147483647) * 2 - 1;
      }
      for (let i = 0, j = 0; i < out.length; i++, j = (j + 1) % period) {
        out[i] = ring[j];
        ring[j] = 0.996 * 0.5 * (ring[j] + ring[(j + 1) % period]);
      }
      break;
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
  // 10 ms fade-out so the buffer end never clicks.
  const fade = Math.round(rate * 0.01);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}
