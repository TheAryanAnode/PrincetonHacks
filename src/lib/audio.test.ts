import { describe, expect, it } from "vitest";
import { VoiceOwnership } from "./audio";

describe("live voice ownership", () => {
  it("releases only the source and control that owns a note", () => {
    const registry = new VoiceOwnership();
    registry.hold("keyboard:key-0", [1]);
    registry.hold("vision:key-0", [2]);
    registry.hold("keyboard:key-1", [3]);
    expect(registry.release("keyboard:key-0")).toEqual([1]);
    expect(registry.has("vision:key-0")).toBe(true);
    expect(registry.has("keyboard:key-1")).toBe(true);
    expect(registry.release("keyboard:key-0")).toEqual([]);
  });

  it("allows repeated attacks under sustain without losing older held voices", () => {
    const registry = new VoiceOwnership();
    registry.hold("pointer:chord", [1, 2, 3]);
    registry.release("pointer:chord", true);
    registry.hold("pointer:chord", [4, 5, 6]);
    registry.release("pointer:chord", true);
    expect(registry.liftPedal()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(registry.liftPedal()).toEqual([]);
  });

  it("releases both held and sustained voices on a single input disconnect", () => {
    const registry = new VoiceOwnership();
    registry.hold("vision:key-0", [1]);
    registry.release("vision:key-0", true);
    registry.hold("vision:key-1", [2]);
    registry.hold("midi:key-0", [3]);
    expect(registry.releaseSource("vision").sort()).toEqual([1, 2]);
    expect(registry.has("midi:key-0")).toBe(true);
    expect(registry.liftPedal()).toEqual([]);
  });

  it("does not reattack a held control when its finite sample ends", () => {
    const registry = new VoiceOwnership();
    registry.hold("keyboard:key-0", [1]);
    registry.forget(1);
    expect(registry.has("keyboard:key-0")).toBe(true);
    expect(registry.hold("keyboard:key-0", [2])).toBe(false);
    registry.release("keyboard:key-0");
    expect(registry.hold("keyboard:key-0", [2])).toBe(true);
  });

  it("forgets stolen or finished voices and resets every source on panic", () => {
    const registry = new VoiceOwnership();
    registry.hold("loop:chord", [1, 2, 3]);
    registry.release("loop:chord", true);
    registry.forget(2);
    expect(registry.liftPedal()).toEqual([1, 3]);
    registry.hold("pointer:key-0", [4]);
    registry.clear();
    expect(registry.has("pointer:key-0")).toBe(false);
    expect(registry.releaseSource("pointer")).toEqual([]);
  });
});
