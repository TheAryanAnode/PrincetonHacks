import { describe, expect, it } from "vitest";
import { NATURAL_NOTES } from "../types";
import { controlsOverlap } from "./geometry";
import { recognizeControls } from "./recognition";

function page(width = 480, height = 340, shade = 255): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = shade;
    data[i + 1] = shade;
    data[i + 2] = shade;
    data[i + 3] = 255;
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

function line(
  image: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness = 2,
) {
  for (let y = y0; y <= y1 + thickness - 1; y++)
    for (let x = x0; x <= x1 + thickness - 1; x++) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 20;
    }
}

function rectangle(
  image: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  line(image, x, y, x + width, y);
  line(image, x, y + height, x + width, y + height);
  line(image, x, y, x, y + height);
  line(image, x + width, y, x + width, y + height);
}

describe("setup-only rectangle recognition", () => {
  it("finds eight adjoining drawn keys, ordered and assigned to a C-major octave", () => {
    const image = page();
    rectangle(image, 40, 80, 400, 200);
    for (let i = 1; i < 8; i++) line(image, 40 + i * 50, 80, 40 + i * 50, 280);
    const controls = recognizeControls(image);
    expect(controls).toHaveLength(8);
    expect(controls.map((control) => control.action)).toEqual(
      NATURAL_NOTES.map((midi) => ({ type: "note", midi })),
    );
    expect(controls.every((control) => control.kind === "key")).toBe(true);
    expect(controlsOverlap(controls)).toEqual([]);
    expect(controls[0].polygon[0][0]).toBeCloseTo(40 / 480, 2);
    expect(controls[7].polygon[2][0]).toBeCloseTo(440 / 480, 2);
  });

  it("finds separated pads under dim lighting without mistaking the outside for a control", () => {
    const image = page(480, 340, 170);
    rectangle(image, 40, 40, 100, 100);
    rectangle(image, 190, 40, 100, 100);
    rectangle(image, 40, 190, 100, 100);
    const controls = recognizeControls(image);
    expect(controls).toHaveLength(3);
    expect(controls.every((control) => control.kind === "pad")).toBe(true);
    expect(controls[1].polygon[0][0]).toBeGreaterThan(
      controls[0].polygon[0][0],
    );
    expect(controls[2].polygon[0][1]).toBeGreaterThan(
      controls[0].polygon[0][1],
    );
  });

  it("returns no detections for blank, dark, and unclosed drawings", () => {
    expect(recognizeControls(page())).toEqual([]);
    expect(recognizeControls(page(480, 340, 0))).toEqual([]);
    const open = page();
    line(open, 60, 60, 60, 260);
    line(open, 60, 60, 400, 60);
    line(open, 400, 60, 400, 260);
    expect(recognizeControls(open)).toEqual([]);
  });

  it("does not promote a sheet border or tiny letter interiors to a full control", () => {
    const image = page();
    rectangle(image, 4, 4, 470, 330);
    rectangle(image, 50, 50, 5, 7);
    rectangle(image, 62, 50, 5, 7);
    expect(recognizeControls(image)).toEqual([]);
  });
});
