import { describe, expect, it } from "vitest";
import { aiToControls, parseNote, whiteKey } from "./aiLayout";
import type { AiShape } from "../../server/identify";

const box = (x0: number, y0: number, x1: number, y1: number, shape: AiShape["shape"] = "rectangle", label = ""): AiShape => ({
  shape,
  points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
  label,
});

describe("aiToControls", () => {
  it("maps each shape type to its instrument, left to right", () => {
    const controls = aiToControls([
      box(0.5, 0.2, 0.6, 0.8),
      box(0.1, 0.2, 0.2, 0.8),
      box(0.3, 0.2, 0.4, 0.8),
      box(0.7, 0.2, 0.8, 0.3, "circle"),
      box(0.85, 0.2, 0.95, 0.3, "triangle"),
    ]);
    expect(controls.map((c) => c.name)).toEqual(["C4", "D4", "E4", "Kick", "C5"]);
    expect(controls[0].action).toEqual({ type: "note", midi: 60, instrument: "piano" });
    expect(controls[3].action).toEqual({ type: "sound", sound: "kick" });
    expect(controls[4].action).toMatchObject({ instrument: "marimba" });
  });
  it("uses letters written in a shape as the exact note, only when enabled", () => {
    const shapes = [box(0.1, 0.2, 0.2, 0.8, "rectangle", "F#"), box(0.3, 0.2, 0.4, 0.8, "diamond", "e"), box(0.6, 0.2, 0.7, 0.3, "circle", "clap")];
    expect(aiToControls(shapes).map((c) => c.name)).toEqual(["F♯4", "E2", "Clap"]);
    expect(aiToControls(shapes, { useLetters: false }).map((c) => c.name)).toEqual(["C4", "C2", "Clap"]);
  });
  it("keeps the traced outline, including non-convex stars and slanted neighbours", () => {
    const star = Array.from({ length: 10 }, (_, k) => {
      const a = (k / 10) * Math.PI * 2, r = k % 2 ? 0.04 : 0.1;
      return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r] as [number, number];
    });
    const controls = aiToControls([
      { shape: "star", points: star, label: "" },
      { shape: "rectangle", points: [[0.02, 0.4], [0.15, 0.4], [0.13, 0.7], [0.0, 0.7]], label: "" },
      { shape: "rectangle", points: [[0.13, 0.4], [0.24, 0.4], [0.24, 0.7], [0.12, 0.7]], label: "" },
    ]);
    expect(controls).toHaveLength(3);
    expect(controls[2].polygon).toHaveLength(10);
    expect(controls[2].action).toEqual({ type: "sound", sound: "chime" });
  });
  it("drops duplicates and junk", () => {
    const controls = aiToControls([
      { shape: "rectangle", points: [[0.1, 0.3], [0.2, 0.3], [0.22, 0.7], [0.05, 0.7]], label: "" },
      box(0.12, 0.35, 0.18, 0.6),
      { shape: "rectangle", points: [[0, 0], [1, 1]], label: "" },
      { shape: "circle", points: [[NaN, 0], [1, 0], [1, 1]], label: "" },
      box(0.5, 0.5, 0.505, 0.505),
    ]);
    expect(controls).toHaveLength(1);
    expect(aiToControls(null as never)).toEqual([]);
  });
  it("parses notes and continues white keys past an octave", () => {
    expect([0, 6, 7, 8].map((n) => whiteKey(n))).toEqual([60, 71, 72, 74]);
    expect(whiteKey(0, 2)).toBe(36);
    expect(["C", "bb", "F#5", "E♭", "H", "kick"].map((l) => parseNote(l))).toEqual([60, 70, 78, 63, null, null]);
  });
});
