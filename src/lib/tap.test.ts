import { describe, expect, it } from "vitest";
import { TapDetector } from "./tap";

const PALM = 0.1;
/** Feed tip y values (in palm widths) at 30 fps, with optional ±jitter (palm widths). */
function run(ys: number[], jitter = 0, d = new TapDetector()) {
  let seed = 7;
  return ys.map((y, i) => {
    seed = (seed * 16807) % 2147483647;
    const noise = jitter * ((seed / 2147483647) * 2 - 1);
    return d.update(i * 33, (y + noise) * PALM, PALM * (1 + noise * 0.3));
  });
}
const rest = (n: number, y = 1) => Array(n).fill(y);
/** A press: quick ~0.3 palm drop, brief hold, lift. */
const press = (from = 1) => [from + 0.1, from + 0.22, from + 0.3, from + 0.32, from + 0.32, from + 0.32, from + 0.2, from + 0.1, from];

describe("TapDetector", () => {
  it("fires once per press and lifts when the finger rises", () => {
    const events = run([...rest(5), ...press(), ...rest(3)]);
    expect(events.filter((e) => e === "tap")).toHaveLength(1);
    expect(events.filter((e) => e === "lift")).toHaveLength(1);
    expect(events.indexOf("tap")).toBeLessThan(events.indexOf("lift"));
  });
  it("catches every one of several quick repeated presses, even with tracker jitter", () => {
    const ys = [...rest(5)];
    for (let k = 0; k < 6; k++) ys.push(...press(), 1);
    expect(run(ys, 0.02).filter((e) => e === "tap")).toHaveLength(6);
  });
  it("ignores slow drifts, hovering and jitter", () => {
    const slow = Array.from({ length: 60 }, (_, i) => 1 + i * 0.012);
    expect(run(slow)).not.toContain("tap");
    expect(run(rest(60), 0.03)).not.toContain("tap");
  });
  it("doesn't count a finger entering the frame as a tap, but catches the first real press", () => {
    const events = run([1.3, 1.5, 1.6, 1.6, ...rest(4, 1.6), ...press(1.6)]);
    expect(events.slice(0, 4)).not.toContain("tap");
    expect(events.filter((e) => e === "tap")).toHaveLength(1);
  });
  it("releases when the hand disappears", () => {
    const d = new TapDetector();
    run([...rest(5), 1.1, 1.22, 1.3, 1.32, 1.32], 0, d);
    expect(d.update(1000, NaN, PALM)).toBe("lift");
  });
});
