/**
 * Tap = the fingertip moves down quickly (in the image) and then brakes hard.
 * One camera can't see contact, so this reads the motion of a press instead. Tuned for a laptop
 * webcam looking down at paper on the desk, where a press is a short downward flick in the image.
 *
 * Distances are in palm widths (scale-free: works near or far from the camera). Positions and palm
 * width are smoothed so landmark jitter can't fake or break a tap.
 */
export const TAP = {
  /** Weight of the newest sample in the smoothing (1 = no smoothing). */
  SMOOTH: 0.6,
  /** Downward travel (palm widths) within WINDOW_MS that counts as a press. */
  DROP: 0.14,
  WINDOW_MS: 280,
  /** The press lands once downward speed falls below this share of its peak (the finger brakes on paper). */
  BRAKE: 0.4,
  /** Rise (palm widths) above the lowest point that re-arms the finger for the next press. */
  REARM: 0.06,
  /** Ignore this long after a finger appears, so entering the frame isn't a tap. */
  SETTLE_MS: 90,
};
// shortcut: thresholds tuned on synthetic traces and one laptop-webcam geometry; adjust TAP if a rig misfires.

export type TapEvent = "tap" | "lift" | null;

export class TapDetector {
  private history: { t: number; y: number }[] = [];
  private y: number | null = null; // smoothed tip y (image units)
  private palm = 0; // smoothed palm width
  private bottom: number | null = null; // lowest y since the press landed; null = armed
  private bornAt: number | null = null;

  reset() {
    this.history = [];
    this.y = null;
    this.palm = 0;
    this.bottom = null;
    this.bornAt = null;
  }

  /** tipY: normalized image y (down = larger). palmWidth: same units. */
  update(t: number, tipY: number, palmWidth: number): TapEvent {
    if (!(palmWidth > 0.005) || !Number.isFinite(tipY)) {
      const wasDown = this.bottom !== null;
      this.reset();
      return wasDown ? "lift" : null;
    }
    this.bornAt ??= t;
    this.palm = this.palm ? this.palm + 0.2 * (palmWidth - this.palm) : palmWidth;
    this.y = this.y === null ? tipY : this.y + TAP.SMOOTH * (tipY - this.y);
    const y = this.y / this.palm;
    this.history.push({ t, y });
    while (this.history.length > 2 && t - this.history[0].t > TAP.WINDOW_MS) this.history.shift();

    if (this.bottom !== null) {
      if (this.bottom - y >= TAP.REARM) {
        this.bottom = null;
        this.history = [{ t, y }];
        return "lift";
      }
      this.bottom = Math.max(this.bottom, y);
      return null;
    }
    if (t - this.bornAt < TAP.SETTLE_MS) {
      this.history = [{ t, y }]; // motion while entering the frame doesn't count toward a press
      return null;
    }
    if (this.history.length < 3) return null;

    // Downward speed (palm widths / s) between consecutive samples.
    const speeds = this.history.slice(1).map((h, i) => (h.y - this.history[i].y) / Math.max(1, h.t - this.history[i].t) * 1000);
    const now = speeds[speeds.length - 1];
    const peak = Math.max(...speeds);
    const top = Math.min(...this.history.map((h) => h.y));
    if (y - top >= TAP.DROP && peak > 0 && now <= peak * TAP.BRAKE) {
      this.bottom = y;
      this.history = [{ t, y }];
      return "tap";
    }
    return null;
  }
}
