import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraController } from "./camera";

afterEach(() => vi.unstubAllGlobals());

function fakeStream() {
  const stop = vi.fn();
  const track = {
    stop,
    addEventListener: vi.fn(),
    getSettings: () => ({ width: 1280, frameRate: 30 }),
  };
  return {
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
    stop,
  };
}

describe("camera lifecycle", () => {
  it("stops a stream if permission resolves after the user stopped setup", async () => {
    let resolve!: (stream: MediaStream) => void;
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () =>
          new Promise<MediaStream>((r) => {
            resolve = r;
          }),
      },
    });
    const camera = new CameraController();
    const pending = camera.start();
    const expectedRejection = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    camera.stop();
    const source = fakeStream();
    resolve(source.stream);
    await expectedRejection;
    expect(source.stop).toHaveBeenCalledOnce();
    expect(camera.stream).toBeNull();
  });

  it("does not replace a newer selected camera with a late old stream", async () => {
    const resolves: Array<(stream: MediaStream) => void> = [];
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => resolves.push(resolve)),
      },
    });
    const camera = new CameraController();
    const first = camera.start("first");
    const expectedRejection = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    const second = camera.start("second");
    const oldSource = fakeStream();
    const newSource = fakeStream();
    resolves[1](newSource.stream);
    await second;
    resolves[0](oldSource.stream);
    await expectedRejection;
    expect(camera.stream).toBe(newSource.stream);
    expect(oldSource.stop).toHaveBeenCalledOnce();
    expect(newSource.stop).not.toHaveBeenCalled();
    expect(camera.getSettings()).toEqual({ width: 1280, frameRate: 30 });
    camera.stop();
    expect(newSource.stop).toHaveBeenCalledOnce();
  });
});
