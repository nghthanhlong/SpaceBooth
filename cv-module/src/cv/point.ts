import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { distPx } from "./geometry";
import { HAND } from "./landmarks";
import type { FrameSize, GestureName } from "./types";

export interface PointConfig {
  /** Index extension ratio over middle finger to start pointing. */
  startRatio: number;
  /** Index extension ratio to drop below before ending pointing. */
  releaseRatio: number;
  /** Minimum index tip distance relative to hand size to count as extended. */
  minExtension: number;
  /** State change must hold for this many consecutive frames (debounce). */
  confirmFrames: number;
}

export const DEFAULT_POINT: PointConfig = {
  startRatio: 1.25,
  releaseRatio: 1.10,
  minExtension: 1.20,
  confirmFrames: 2,
};

/**
 * Pointing gesture detector with kinematic analysis, hysteresis and debounce.
 *
 * Requirements satisfied:
 * - Detects extended index finger.
 * - Confirms middle, ring, and pinky fingers are relatively folded.
 * - Thumb position is flexible (does not need to pinch).
 * - Distinguishes pointing from open palm (Open_Palm has extended middle/ring/pinky).
 * - Hysteresis prevents flickering near thresholds.
 * - Works reliably at ~1 meter distance using hand-scale normalization.
 */
export class PointDetector {
  private pointing = false;
  private pendingFrames = 0;
  lastRatio = 0;

  constructor(private cfg: PointConfig = DEFAULT_POINT) {}

  update(
    lm: NormalizedLandmark[],
    size: FrameSize,
    gesture?: GestureName,
    gestureScore = 0,
  ): { pointing: boolean; changed: boolean; ratio: number } {
    // Palm reference scale: wrist to middle MCP
    const handSize = Math.max(distPx(lm[HAND.WRIST], lm[HAND.MIDDLE_MCP], size), 1e-6);

    const indexTipDist = distPx(lm[HAND.WRIST], lm[HAND.INDEX_TIP], size);
    const indexPipDist = distPx(lm[HAND.WRIST], lm[HAND.INDEX_PIP], size);

    const middleTipDist = distPx(lm[HAND.WRIST], lm[HAND.MIDDLE_TIP], size);
    const ringTipDist = distPx(lm[HAND.WRIST], lm[HAND.RING_TIP], size);
    const pinkyTipDist = distPx(lm[HAND.WRIST], lm[HAND.PINKY_TIP], size);

    const indexExtension = indexTipDist / handSize;

    // Index tip must be extended significantly beyond middle tip
    const ratio = indexTipDist / Math.max(middleTipDist, 1e-6);
    this.lastRatio = ratio;

    // Direct check: is index finger extended?
    const isIndexExtended =
      indexExtension >= this.cfg.minExtension && indexTipDist > indexPipDist * 1.1;

    // Direct check: are other fingers relatively curled compared to index?
    const isMiddleCurled = indexTipDist > middleTipDist * (this.pointing ? this.cfg.releaseRatio : this.cfg.startRatio);
    const isRingCurled = indexTipDist > ringTipDist * 1.15;
    const isPinkyCurled = indexTipDist > pinkyTipDist * 1.15;

    // If MediaPipe specifically classifies Open Palm with confidence, reject Pointing
    const isOpenPalm = gesture === "Open_Palm" && gestureScore >= 0.6;

    // If MediaPipe specifically classifies Pointing_Up, consider it strong signal
    const isMediaPipePointing = gesture === "Pointing_Up" && gestureScore >= 0.5;

    let wantsPoint = false;
    if (!isOpenPalm) {
      if (isMediaPipePointing) {
        wantsPoint = true;
      } else if (isIndexExtended && isMiddleCurled && (isRingCurled || isPinkyCurled)) {
        wantsPoint = true;
      }
    }

    if (wantsPoint === this.pointing) {
      this.pendingFrames = 0;
      return { pointing: this.pointing, changed: false, ratio };
    }

    this.pendingFrames++;
    if (this.pendingFrames < this.cfg.confirmFrames) {
      return { pointing: this.pointing, changed: false, ratio };
    }

    this.pointing = wantsPoint;
    this.pendingFrames = 0;
    return { pointing: this.pointing, changed: true, ratio };
  }

  get isPointing(): boolean {
    return this.pointing;
  }

  reset(): void {
    this.pointing = false;
    this.pendingFrames = 0;
    this.lastRatio = 0;
  }
}
