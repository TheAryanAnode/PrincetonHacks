import { describe, expect, it } from "vitest";
import { findRegions, inkMap, mergeShapes } from "./regions";
import type { Point } from "../types";
import type { AiShape } from "../../server/identify";

const W = 400, H = 300;
/** Lined paper with gray pencil outlines (3 px) of the given closed polygons. */
function page(shapes: Point[][]) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const paint = (x: number, y: number, rgb: number[]) => {
    if (x >= 0 && y >= 0 && x < W && y < H) data.set([...rgb, 255], (y * W + x) * 4);
  };
  for (let y = 8; y < H; y += 14) for (let x = 0; x < W; x++) paint(x, y, [170, 200, 240]);
  for (const s of shapes)
    s.forEach((a, i) => {
      const b = s[(i + 1) % s.length];
      for (let t = 0; t <= 1; t += 0.002)
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++)
          paint(Math.round(a[0] + (b[0] - a[0]) * t) + ox, Math.round(a[1] + (b[1] - a[1]) * t) + oy, [105, 105, 110]);
    });
  return { width: W, height: H, data };
}
const polyArea = (p: Point[]) => Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;
const ring = (cx: number, cy: number, r: number, n: number, inner = r) =>
  Array.from({ length: n }, (_, k) => {
    const a = -Math.PI / 2 + (k / n) * Math.PI * 2, rr = k % 2 ? inner : r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as Point;
  });

const KEY: Point[] = [[30, 40], [90, 50], [95, 250], [20, 240]]; // slanted, like a keyboard key in perspective
const TRI: Point[] = [[160, 40], [220, 150], [100, 150]];
const CIRCLE = ring(290, 90, 50, 40);
const STAR = ring(200, 230, 55, 10, 22);

describe("findRegions", () => {
  const regions = findRegions(inkMap(page([KEY, TRI, CIRCLE, STAR])), W, H);
  const norm = (p: Point[]) => p.map(([x, y]) => [x / W, y / H] as Point);
  it("finds one outline per drawn shape, matching its real size (not the ruled lines)", () => {
    expect(regions).toHaveLength(4);
    for (const truth of [KEY, TRI, CIRCLE, STAR]) {
      const c: Point = [truth.reduce((s, p) => s + p[0], 0) / truth.length / W, truth.reduce((s, p) => s + p[1], 0) / truth.length / H];
      const r = regions.find((r) => r.samples.some(([x, y]) => Math.hypot(x - c[0], y - c[1]) < 0.03))!;
      expect(r).toBeTruthy();
      const ratio = polyArea(r.points) / polyArea(norm(truth));
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.1);
    }
  });
  it("takes the AI's type and label but the drawing's outline; label goes to one shape only", () => {
    const key = regions.find((r) => r.samples.every(([x]) => x < 0.3))!;
    // AI box: roughly over the key, a bit off, with a letter.
    const merged = mergeShapes([{ shape: "rectangle", points: norm([[25, 30], [100, 30], [100, 245], [25, 245]]), label: "F#" }], regions);
    const k = merged.find((m) => m.points === key.points)!;
    expect(k).toMatchObject({ shape: "rectangle", label: "F#" });
    expect(merged.filter((m) => m.label === "F#")).toHaveLength(1);
    // Patches the AI didn't report (here: triangle, circle, star) are ignored.
    expect(merged).toHaveLength(1);
  });
  it("writing inside a shape doesn't split it", () => {
    // A key with a bar of "handwriting" nearly spanning it (gaps of 3 px to each side).
    const bar: Point[] = [[39, 150], [76, 150], [76, 152], [39, 152]];
    const r = findRegions(inkMap(page([KEY, bar])), W, H);
    expect(r).toHaveLength(1);
  });
  it("joins a shape that writing cut in two, but never two real neighbours", () => {
    // Bar touching both sides of the key splits it into two patches.
    const bar: Point[] = [[24, 150], [93, 150], [93, 152], [24, 152]];
    const split = findRegions(inkMap(page([KEY, bar])), W, H);
    expect(split).toHaveLength(2);
    const box = (pts: Point[]) => pts.map(([x, y]) => [x / W, y / H] as Point);
    const one = mergeShapes([{ shape: "rectangle", points: box([[22, 42], [93, 42], [93, 248], [22, 248]]), label: "F#" }], split);
    expect(one).toHaveLength(1);
    expect(one[0].label).toBe("F#");
    // Two separate keys under one sloppy AI box stay two keys.
    const keys = findRegions(inkMap(page([KEY, KEY.map(([x, y]) => [x + 90, y] as Point)])), W, H);
    const two = mergeShapes([{ shape: "rectangle", points: box([[40, 40], [160, 40], [160, 250], [40, 250]]), label: "" }], keys);
    expect(two).toHaveLength(2);
  });
  it("falls back to the AI outline when gray ruled lines slice a key into strips", () => {
    const lines: Point[][] = [];
    for (let x = 12; x < W; x += 16) lines.push([[x, 0], [x + 0.5, 0], [x + 0.5, H - 1], [x, H - 1]]);
    const strips = findRegions(inkMap(page([KEY, ...lines])), W, H);
    const aiKey: AiShape = { shape: "rectangle", points: KEY.map(([x, y]) => [x / W, y / H] as Point), label: "" };
    const out = mergeShapes([aiKey], strips);
    expect(out).toEqual([aiKey]);
  });
});
