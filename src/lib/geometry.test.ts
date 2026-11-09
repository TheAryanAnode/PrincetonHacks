import { describe, expect, it } from "vitest";
import type { Corners, PaperControl, Point } from "../types";
import {
  computeHomography,
  controlsOverlap,
  homographyToCss,
  invertHomography,
  pointInPolygon,
  transformPoint,
  validateCorners,
} from "./geometry";

const unit: Corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const paper: Corners = [
  [0.17, 0.12],
  [0.85, 0.22],
  [0.91, 0.86],
  [0.1, 0.73],
];
const control = (id: string, polygon: Point[]): PaperControl => ({
  id,
  polygon,
  name: id,
  kind: "key",
  action: { type: "note", midi: 60 },
});

describe("paper calibration", () => {
  it("maps all four corners under perspective and round-trips interior fingertips", () => {
    const matrix = computeHomography(unit, paper);
    const inverse = invertHomography(matrix);
    for (let i = 0; i < 4; i++) {
      const projected = transformPoint(matrix, unit[i]);
      expect(projected[0]).toBeCloseTo(paper[i][0], 10);
      expect(projected[1]).toBeCloseTo(paper[i][1], 10);
    }
    for (const point of [
      [0.13, 0.89],
      [0.5, 0.5],
      [0.91, 0.07],
    ] as Point[]) {
      const restored = transformPoint(inverse, transformPoint(matrix, point));
      expect(restored[0]).toBeCloseTo(point[0], 10);
      expect(restored[1]).toBeCloseTo(point[1], 10);
    }
  });

  it("rejects crossed, collapsed, reversed, tiny, or off-camera corners", () => {
    expect(validateCorners(paper)).toBe(true);
    expect(validateCorners(unit)).toBe(true);
    expect(validateCorners([unit[0], unit[2], unit[1], unit[3]])).toBe(false);
    expect(
      validateCorners([
        [0.1, 0.1],
        [0.4, 0.1],
        [0.7, 0.1],
        [0.8, 0.1],
      ]),
    ).toBe(false);
    expect(validateCorners([unit[0], unit[3], unit[2], unit[1]])).toBe(false);
    expect(
      validateCorners([
        [0, 0],
        [0.01, 0],
        [0.01, 0.01],
        [0, 0.01],
      ]),
    ).toBe(false);
    expect(
      validateCorners([
        [-0.1, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
    ).toBe(false);
  });

  it("reports unsolvable transforms instead of creating invalid calibration data", () => {
    expect(() =>
      computeHomography(
        [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        paper,
      ),
    ).toThrow();
    expect(() => invertHomography([1, 0, 0, 0, 0, 0, 0, 0, 1])).toThrow();
    expect(
      transformPoint([1, 0, 0, 0, 1, 0, 0, 0, 0], [0.5, 0.5]).every(
        Number.isNaN,
      ),
    ).toBe(true);
  });

  it("lays out CSS transforms with translation and perspective in the correct columns", () => {
    const matrix = computeHomography(unit, paper);
    const css = homographyToCss(matrix).slice(9, -1).split(",").map(Number);
    const point: Point = [0.32, 0.71];
    const denominator = css[3] * point[0] + css[7] * point[1] + css[15];
    const cssPoint = [
      (css[0] * point[0] + css[4] * point[1] + css[12]) / denominator,
      (css[1] * point[0] + css[5] * point[1] + css[13]) / denominator,
    ];
    expect(cssPoint).toEqual(transformPoint(matrix, point));
  });
});

describe("paper-space hit testing", () => {
  it("handles edges, off-paper fingertips, and concave controls", () => {
    const lShape: Point[] = [
      [0, 0],
      [1, 0],
      [1, 0.3],
      [0.3, 0.3],
      [0.3, 1],
      [0, 1],
    ];
    expect(pointInPolygon([0.2, 0.9], lShape)).toBe(true);
    expect(pointInPolygon([0.8, 0.8], lShape)).toBe(false);
    expect(pointInPolygon([0, 0.5], lShape)).toBe(true);
    expect(pointInPolygon([-0.1, 0.5], unit)).toBe(false);
    expect(pointInPolygon([NaN, 0.5], unit)).toBe(false);
  });

  it("allows adjoining keys while detecting duplicates, containment, and crossing strips", () => {
    const left = control("left", [
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ]);
    const right = control("right", [
      [0.5, 0],
      [1, 0],
      [1, 1],
      [0.5, 1],
    ]);
    expect(controlsOverlap([left, right])).toEqual([]);
    expect(controlsOverlap([left, control("copy", left.polygon)])).toEqual([
      "left",
      "copy",
    ]);
    const inner = control("inner", [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.2, 0.2],
      [0.1, 0.2],
    ]);
    expect(controlsOverlap([left, inner, right])).toEqual(["left", "inner"]);
    const horizontal = control("horizontal", [
      [0, 0.4],
      [1, 0.4],
      [1, 0.6],
      [0, 0.6],
    ]);
    const vertical = control("vertical", [
      [0.4, 0],
      [0.6, 0],
      [0.6, 1],
      [0.4, 1],
    ]);
    expect(controlsOverlap([horizontal, vertical])).toEqual([
      "horizontal",
      "vertical",
    ]);
  });
});
