import { describe, expect, it } from "vitest";
import { renderNote } from "./synth";

const rms = (a: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};

describe("renderNote", () => {
  for (const inst of ["marimba", "guitar", "bass", "organ", "synth"] as const)
    it(`${inst}: audible, finite, normalized, ends silent`, () => {
      const a = renderNote(inst, 57, 48000);
      expect(a.every(Number.isFinite)).toBe(true);
      expect(a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeCloseTo(0.9, 1);
      expect(rms(a, 0, 4800)).toBeGreaterThan(0.05);
      expect(Math.abs(a[a.length - 1])).toBe(0);
    });
  it("percussive voices decay, organ holds", () => {
    const m = renderNote("marimba", 72, 48000), o = renderNote("organ", 72, 48000);
    expect(rms(m, 48000, 52800)).toBeLessThan(rms(m, 0, 4800) * 0.1);
    expect(rms(o, 96000, 100800)).toBeGreaterThan(rms(o, 4800, 9600) * 0.7);
  });
  it("plays the requested pitch (zero crossings of a bass A2 ≈ 110 Hz)", () => {
    const a = renderNote("organ", 45, 48000);
    let crossings = 0;
    for (let i = 4800; i < 52800; i++) if (a[i - 1] < 0 && a[i] >= 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(108);
    expect(crossings).toBeLessThanOrEqual(112 * 2); // harmonics may add a few extra crossings
  });
});
