import { describe, expect, it } from "vitest";
import { createDefaultLayout, isLayout } from "./layout";
import { validateControlPolygon } from "./geometry";

describe("persisted layout boundary", () => {
  it("accepts a saved piano and rejects missing/duplicate IDs and invalid MIDI notes", () => {
    const layout = createDefaultLayout();
    expect(isLayout(layout)).toBe(true);
    expect(isLayout({ ...layout, controls: [null] })).toBe(false);
    expect(
      isLayout({
        ...layout,
        controls: [layout.controls[0], layout.controls[0]],
      }),
    ).toBe(false);
    expect(
      isLayout({
        ...layout,
        controls: [
          { ...layout.controls[0], action: { type: "note", midi: 200 } },
        ],
      }),
    ).toBe(false);
  });
  it("rejects crossed, collapsed, or out-of-page control geometry", () => {
    expect(
      validateControlPolygon([
        [0.1, 0.1],
        [0.4, 0.4],
        [0.4, 0.1],
        [0.1, 0.4],
      ]),
    ).toBe(false);
    expect(
      validateControlPolygon([
        [0.1, 0.1],
        [0.1, 0.1],
        [0.3, 0.3],
      ]),
    ).toBe(false);
    expect(
      validateControlPolygon([
        [0, 0],
        [1.1, 0],
        [1, 1],
        [0, 1],
      ]),
    ).toBe(false);
    expect(
      validateControlPolygon([
        [0.1, 0.1],
        [0.4, 0.1],
        [0.4, 0.4],
        [0.1, 0.4],
      ]),
    ).toBe(true);
  });
});
