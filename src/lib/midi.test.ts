import { afterEach, describe, expect, it, vi } from "vitest";
import { MidiController } from "./midi";

class FakeInput extends EventTarget {
  state: MIDIPortDeviceState = "connected";
  name: string;
  type = "input";
  open = vi.fn(async () => this);
  close = vi.fn(async () => this);
  constructor(readonly id: string) {
    super();
    this.name = id;
  }
  send(data: number[]) {
    const event = new Event("midimessage");
    Object.defineProperty(event, "data", { value: Uint8Array.from(data) });
    this.dispatchEvent(event);
  }
}

class FakeAccess extends EventTarget {
  inputs = new Map<string, FakeInput>();
}

function setup(...inputs: FakeInput[]) {
  const access = new FakeAccess();
  inputs.forEach((input) => access.inputs.set(input.id, input));
  const request = vi.fn(async () => access);
  vi.stubGlobal("navigator", { requestMIDIAccess: request });
  return { access, request };
}

afterEach(() => vi.unstubAllGlobals());

describe("MIDI note ownership", () => {
  it("requests permission only on connect and treats velocity-zero as note-off", async () => {
    const input = new FakeInput("piano");
    const { request } = setup(input);
    const midi = new MidiController();
    const onEvent = vi.fn();
    expect(request).not.toHaveBeenCalled();
    await midi.connect(onEvent, vi.fn());
    expect(request).toHaveBeenCalledWith({ sysex: false });
    input.send([0x92, 60, 127]);
    input.send([0x92, 60, 0]);
    expect(onEvent.mock.calls).toEqual([
      [60, "down", 1, "piano:2"],
      [60, "up", 0, "piano:2"],
    ]);
    midi.disconnect();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("releases a removed input without stealing another device or channel note", async () => {
    const a = new FakeInput("a");
    const b = new FakeInput("b");
    const { access } = setup(a, b);
    const midi = new MidiController();
    const onEvent = vi.fn();
    const onStatus = vi.fn();
    await midi.connect(onEvent, onStatus);
    a.send([0x90, 60, 100]);
    b.send([0x91, 60, 100]);
    a.state = "disconnected";
    access.dispatchEvent(new Event("statechange"));
    await Promise.resolve();
    expect(onEvent.mock.calls.filter((call) => call[1] === "up")).toEqual([
      [60, "up", 0, "a:0"],
    ]);
    expect(onStatus).toHaveBeenCalledWith(false, "a disconnected");
    midi.disconnect();
    expect(onEvent.mock.calls.filter((call) => call[1] === "up")).toEqual([
      [60, "up", 0, "a:0"],
      [60, "up", 0, "b:1"],
    ]);
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).toHaveBeenCalledOnce();
    b.send([0x90, 62, 127]);
    expect(onEvent.mock.calls.at(-1)).toEqual([60, "up", 0, "b:1"]);
  });

  it("limits all-notes-off to the requesting channel and releases retriggers", async () => {
    const input = new FakeInput("piano");
    setup(input);
    const midi = new MidiController();
    const onEvent = vi.fn();
    await midi.connect(onEvent, vi.fn());
    input.send([0x90, 60, 127]);
    input.send([0x90, 60, 127]);
    expect(onEvent.mock.calls.slice(0, 3)).toEqual([
      [60, "down", 1, "piano:0"],
      [60, "up", 0, "piano:0"],
      [60, "down", 1, "piano:0"],
    ]);
    input.send([0x91, 64, 127]);
    input.send([0xb0, 123, 0]);
    expect(onEvent.mock.calls.at(-1)).toEqual([60, "up", 0, "piano:0"]);
    midi.disconnect();
    expect(onEvent.mock.calls.at(-1)).toEqual([64, "up", 0, "piano:1"]);
  });
});
