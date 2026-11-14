import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { Point } from "../types";

export interface HandFrame {
  /** Monotonic time of the source observation, not physical action-to-audio latency. */
  timestampMs: number;
  /** Index fingertip in unmirrored, normalized camera coordinates. Null means release. */
  tip: Point | null;
  landmarks: NormalizedLandmark[];
  /** Thumb/index distance divided by palm width. Lower = closed. Not surface contact. */
  pinch: number;
  /** Index-knuckle to pinky-knuckle distance in normalized image units; 0 when no hand. */
  palmWidth: number;
  /** Every fingertip of every visible hand (up to 2). id = "<hand>:<finger 0-4>", finger 1 = index. */
  fingers: Finger[];
  /** Handedness classification score; this is not a physical-contact confidence. */
  confidence: number;
  handedness: string | null;
}

export interface Finger {
  id: string;
  tip: Point;
  palmWidth: number;
}

const TIPS = [4, 8, 12, 16, 20];
const DIPS = [3, 7, 11, 15, 19]; // joint just behind each tip
/** From a high, steep webcam the pad touching the paper sits a little past the tip landmark. */
const CONTACT_REACH = 0.2;

export interface TrackingDiagnostics {
  fps: number;
  cameraFps: number;
  inferenceMs: number;
  frames: number;
  skippedFrames: number;
  lastFrameAt: number;
  handVisible: boolean;
  lostTrackingCount: number;
  status: "idle" | "loading" | "ready" | "running" | "paused" | "error";
  error: string | null;
  delegate: "GPU" | "CPU" | null;
}

const STALE_AFTER_MS = 120;
const assetBase = `${import.meta.env.BASE_URL}models`;

/** One fresh camera frame per synchronous inference; no buffered inference queue. */
export class HandTracker {
  readonly diagnostics: TrackingDiagnostics = {
    fps: 0,
    cameraFps: 0,
    inferenceMs: 0,
    frames: 0,
    skippedFrames: 0,
    lastFrameAt: 0,
    handVisible: false,
    lostTrackingCount: 0,
    status: "idle",
    error: null,
    delegate: null,
  };

  private model: HandLandmarker | null = null;
  private loading: Promise<void> | null = null;
  private disposed = false;
  private video: HTMLVideoElement | null = null;
  private onFrame: ((frame: HandFrame) => void) | null = null;
  private frameHandle: number | null = null;
  private usesVideoCallback = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastVideoTime = -1;
  private lastPresentedFrames = 0;
  private lastInferenceAt = 0;
  private lastTimestamp = 0;

  async init(): Promise<void> {
    if (this.disposed)
      throw new Error("This tracker has been disposed. Create a new tracker.");
    if (this.model) return;
    if (this.loading) return this.loading;
    this.diagnostics.status = "loading";
    this.diagnostics.error = null;
    this.loading = this.loadModel();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async loadModel(): Promise<void> {
    try {
      const fileset = await FilesetResolver.forVisionTasks(`${assetBase}/wasm`);
      const options = {
        runningMode: "VIDEO" as const,
        numHands: 2,
        // Lower than default: steep desk angles make MediaPipe less sure, and dropping a hand mid-press is worse than a stray frame.
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      let model: HandLandmarker;
      try {
        model = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: {
            modelAssetPath: `${assetBase}/hand_landmarker.task`,
            delegate: "GPU",
          },
        });
        this.diagnostics.delegate = "GPU";
      } catch {
        if (this.disposed) return;
        model = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: {
            modelAssetPath: `${assetBase}/hand_landmarker.task`,
            delegate: "CPU",
          },
        });
        this.diagnostics.delegate = "CPU";
      }
      if (this.disposed) {
        model.close();
        return;
      }
      this.model = model;
      this.diagnostics.status = "ready";
    } catch (error) {
      this.diagnostics.status = "error";
      this.diagnostics.error =
        error instanceof Error
          ? error.message
          : "Hand tracking could not initialize.";
      throw new Error(
        "Local hand tracking could not load. Retry or use keyboard / MIDI input.",
        { cause: error },
      );
    }
  }

  start(video: HTMLVideoElement, onFrame: (frame: HandFrame) => void): void {
    if (!this.model)
      throw new Error(
        "Call and await HandTracker.init() before starting tracking.",
      );
    this.stop();
    this.video = video;
    this.onFrame = onFrame;
    this.running = true;
    this.lastVideoTime = -1;
    this.lastPresentedFrames = 0;
    this.lastInferenceAt = 0;
    this.diagnostics.lastFrameAt = performance.now();
    this.diagnostics.error = null;
    this.diagnostics.status = "running";
    this.usesVideoCallback =
      typeof video.requestVideoFrameCallback === "function";
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    video.addEventListener("ended", this.onVideoUnavailable);
    video.addEventListener("emptied", this.onVideoUnavailable);
    video.addEventListener("pause", this.onVideoUnavailable);
    // rVFC stops when the source stalls, so release cannot depend on another frame.
    this.watchdog = setInterval(() => {
      if (performance.now() - this.diagnostics.lastFrameAt > STALE_AFTER_MS) {
        this.release();
        this.diagnostics.status = "paused";
        this.diagnostics.fps = 0;
        this.diagnostics.cameraFps = 0;
      }
    }, 30);
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle !== null) {
      if (this.usesVideoCallback)
        this.video?.cancelVideoFrameCallback(this.frameHandle);
      else cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = null;
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.watchdog = null;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.video?.removeEventListener("ended", this.onVideoUnavailable);
    this.video?.removeEventListener("emptied", this.onVideoUnavailable);
    this.video?.removeEventListener("pause", this.onVideoUnavailable);
    this.release(true);
    this.video = null;
    this.onFrame = null;
    this.diagnostics.fps = 0;
    this.diagnostics.cameraFps = 0;
    this.diagnostics.status = this.model ? "ready" : "idle";
  }

  /** Release WebGL/WASM resources on unmount; stop() alone supports restarting. */
  dispose(): void {
    this.stop();
    this.disposed = true;
    this.model?.close();
    this.model = null;
    this.diagnostics.status = "idle";
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) this.release();
  };

  private onVideoUnavailable = (): void => {
    this.release();
    this.diagnostics.status = "paused";
  };

  private schedule(): void {
    if (!this.running || !this.video) return;
    if (this.usesVideoCallback) {
      this.frameHandle = this.video.requestVideoFrameCallback(
        (_now, metadata) => {
          const presentedDelta = this.lastPresentedFrames
            ? metadata.presentedFrames - this.lastPresentedFrames
            : 1;
          if (this.lastPresentedFrames) {
            this.diagnostics.skippedFrames += Math.max(0, presentedDelta - 1);
          }
          this.lastPresentedFrames = metadata.presentedFrames;
          this.process(metadata.mediaTime, presentedDelta);
        },
      );
    } else {
      this.frameHandle = requestAnimationFrame(() =>
        this.process(this.video?.currentTime ?? -1),
      );
    }
  }

  private process(mediaTime: number, presentedDelta = 1): void {
    this.frameHandle = null;
    if (!this.running || !this.video || !this.model) return;
    const video = this.video;
    if (
      document.hidden ||
      video.paused ||
      video.readyState < 2 ||
      !video.videoWidth ||
      mediaTime === this.lastVideoTime
    ) {
      this.schedule();
      return;
    }
    const previousVideoTime = this.lastVideoTime;
    this.lastVideoTime = mediaTime;
    const timestampMs = Math.max(performance.now(), this.lastTimestamp + 0.01);
    this.lastTimestamp = timestampMs;
    try {
      const startedAt = performance.now();
      const result = this.model.detectForVideo(video, timestampMs);
      this.diagnostics.inferenceMs = performance.now() - startedAt;
      this.diagnostics.lastFrameAt = performance.now();
      this.diagnostics.frames += 1;
      this.diagnostics.status = "running";
      if (this.lastInferenceAt) {
        const fps = 1000 / (timestampMs - this.lastInferenceAt);
        this.diagnostics.fps = this.diagnostics.fps
          ? this.diagnostics.fps * 0.8 + fps * 0.2
          : fps;
      }
      if (previousVideoTime >= 0 && mediaTime > previousVideoTime) {
        const cameraFps = presentedDelta / (mediaTime - previousVideoTime);
        this.diagnostics.cameraFps = this.diagnostics.cameraFps
          ? this.diagnostics.cameraFps * 0.8 + cameraFps * 0.2
          : cameraFps;
      }
      this.lastInferenceAt = timestampMs;
      // A slow inference must not activate a note using an already stale position.
      if (this.diagnostics.inferenceMs > STALE_AFTER_MS) {
        this.release(true);
        this.diagnostics.status = "paused";
        this.schedule();
        return;
      }
      const landmarks = result.landmarks[0];
      if (
        !landmarks ||
        landmarks.length < 21 ||
        !landmarks.every(
          (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
        )
      ) {
        this.release(true, timestampMs);
      } else {
        const aspect = video.videoWidth / video.videoHeight;
        const distance = (a: NormalizedLandmark, b: NormalizedLandmark) =>
          Math.hypot((a.x - b.x) * aspect, a.y - b.y);
        const palmWidth = distance(landmarks[5], landmarks[17]);
        const pinch =
          palmWidth > 0.005
            ? distance(landmarks[4], landmarks[8]) / palmWidth
            : Infinity;
        const fingers: Finger[] = [];
        result.landmarks.forEach((hand, h) => {
          if (hand.length < 21) return;
          // Handedness keeps ids stable when MediaPipe reorders hands between frames.
          let name = result.handedness[h]?.[0]?.categoryName ?? String(h);
          if (fingers.some((f) => f.id.startsWith(`${name}:`))) name += h;
          const width = distance(hand[5], hand[17]);
          TIPS.forEach((t, f) => {
            const tip = hand[t], dip = hand[DIPS[f]];
            if (![tip.x, tip.y, dip.x, dip.y].every(Number.isFinite)) return;
            fingers.push({
              id: `${name}:${f}`,
              tip: [tip.x + (tip.x - dip.x) * CONTACT_REACH, tip.y + (tip.y - dip.y) * CONTACT_REACH],
              palmWidth: width,
            });
          });
        });
        this.diagnostics.handVisible = true;
        this.onFrame?.({
          timestampMs,
          tip: [landmarks[8].x, landmarks[8].y],
          landmarks,
          pinch,
          palmWidth,
          fingers,
          confidence: result.handedness[0]?.[0]?.score ?? 0,
          handedness: result.handedness[0]?.[0]?.categoryName ?? null,
        });
      }
    } catch (error) {
      this.stop();
      this.diagnostics.status = "error";
      this.diagnostics.error =
        error instanceof Error
          ? error.message
          : "Hand tracking stopped unexpectedly.";
      return;
    }
    this.schedule();
  }

  private release(force = false, timestampMs = performance.now()): void {
    if (!this.diagnostics.handVisible && !force) return;
    if (this.diagnostics.handVisible) this.diagnostics.lostTrackingCount += 1;
    this.diagnostics.handVisible = false;
    this.onFrame?.({
      timestampMs,
      tip: null,
      landmarks: [],
      pinch: Infinity,
      palmWidth: 0,
      fingers: [],
      confidence: 0,
      handedness: null,
    });
  }
}
