import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({ detectForVideo: vi.fn(), close: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  HandLandmarker: { createFromOptions: vi.fn(async () => model) },
}));
import { HandTracker } from "./tracking";

function hand() {
  const landmarks = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  landmarks[5] = { x: 0.4, y: 0.6, z: 0 };
  landmarks[17] = { x: 0.6, y: 0.6, z: 0 };
  landmarks[4] = { x: 0.52, y: 0.4, z: 0 };
  landmarks[8] = { x: 0.5, y: 0.4, z: 0 };
  return {
    landmarks: [landmarks],
    handedness: [[{ score: 0.99, categoryName: "Left" }]],
  };
}

class FakeVideo extends EventTarget {
  paused = false;
  readyState = 4;
  videoWidth = 1280;
  videoHeight = 720;
  currentTime = 0;
}

let scheduled: FrameRequestCallback | null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    scheduled = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    scheduled = null;
  });
  scheduled = null;
  model.detectForVideo.mockReset().mockReturnValue(hand());
  model.close.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function frame() {
  const callback = scheduled;
  scheduled = null;
  callback?.(performance.now());
}

describe("fresh tracking observations", () => {
  it("processes each video timestamp once and releases a stalled feed within 150 ms", async () => {
    const tracker = new HandTracker();
    await tracker.init();
    const video = new FakeVideo();
    const onFrame = vi.fn();
    tracker.start(video as unknown as HTMLVideoElement, onFrame);
    frame();
    frame();
    expect(model.detectForVideo).toHaveBeenCalledOnce();
    expect(onFrame.mock.calls[0][0].tip).toEqual([0.5, 0.4]);
    // every fingertip is reported, index finger = finger 1
    expect(onFrame.mock.calls[0][0].fingers).toHaveLength(5);
    // contact point reaches 20% past the tip (0.4) away from its joint (0.5)
    const [x, y] = onFrame.mock.calls[0][0].fingers[1].tip;
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0.38);
    vi.advanceTimersByTime(150);
    expect(onFrame.mock.calls.at(-1)?.[0].tip).toBeNull();
    expect(tracker.diagnostics.status).toBe("paused");
    tracker.dispose();
    expect(model.close).toHaveBeenCalledOnce();
  });

  it("immediately emits a release when the next fresh frame has no hand", async () => {
    const tracker = new HandTracker();
    await tracker.init();
    const video = new FakeVideo();
    const onFrame = vi.fn();
    tracker.start(video as unknown as HTMLVideoElement, onFrame);
    frame();
    model.detectForVideo.mockReturnValue({ landmarks: [], handedness: [] });
    video.currentTime += 1 / 30;
    frame();
    expect(onFrame.mock.calls.at(-1)?.[0]).toMatchObject({
      tip: null,
      pinch: Infinity,
      palmWidth: 0,
      fingers: [],
    });
    expect(tracker.diagnostics.lostTrackingCount).toBe(1);
    tracker.dispose();
  });

  it("discards an observation if inference itself made it stale", async () => {
    model.detectForVideo.mockImplementation(() => {
      vi.advanceTimersByTime(130);
      return hand();
    });
    const tracker = new HandTracker();
    await tracker.init();
    const onFrame = vi.fn();
    tracker.start(new FakeVideo() as unknown as HTMLVideoElement, onFrame);
    frame();
    expect(
      onFrame.mock.calls.every(([observation]) => observation.tip === null),
    ).toBe(true);
    expect(tracker.diagnostics.status).toBe("paused");
    tracker.dispose();
  });
});
