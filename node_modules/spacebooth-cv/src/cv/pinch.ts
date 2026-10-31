import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { distPx } from "./geometry";
import { HAND } from "./landmarks";
import type { FrameSize } from "./types";

export interface PinchConfig {
  /** Pinch starts when thumb-index distance / hand size drops below this. */
  startRatio: number;
  /** Pinch ends when the ratio rises above this. Must be > startRatio (hysteresis). */
  releaseRatio: number;
  /** A state change must hold for this many consecutive frames (debounce). */
  confirmFrames: number;
}

export const DEFAULT_PINCH: PinchConfig = {
  startRatio: 0.25,
  releaseRatio: 0.4,
  confirmFrames: 2,
};

/**
 * Pinch detection with hysteresis + debounce.
 * The distance is divided by the hand size (wrist -> middle MCP), so the same
 * threshold works whether the user stands at 1.0 m or 1.5 m.
 */
export class PinchDetector {
  private pinching = false;
  private pendingFrames = 0;
  lastRatio = 0;

  constructor(private cfg: PinchConfig = DEFAULT_PINCH) {}

  update(lm: NormalizedLandmark[], size: FrameSize): { pinching: boolean; changed: boolean } {
    const handSize = distPx(lm[HAND.WRIST], lm[HAND.MIDDLE_MCP], size);
    const gap = distPx(lm[HAND.THUMB_TIP], lm[HAND.INDEX_TIP], size);
    const ratio = gap / Math.max(handSize, 1e-6);
    this.lastRatio = ratio;

    const wantsPinch = this.pinching ? ratio < this.cfg.releaseRatio : ratio < this.cfg.startRatio;

    if (wantsPinch === this.pinching) {
      this.pendingFrames = 0;
      return { pinching: this.pinching, changed: false };
    }

    this.pendingFrames++;
    if (this.pendingFrames < this.cfg.confirmFrames) {
      return { pinching: this.pinching, changed: false };
    }

    this.pinching = wantsPinch;
    this.pendingFrames = 0;
    return { pinching: this.pinching, changed: true };
  }

  get isPinching(): boolean {
    return this.pinching;
  }

  reset(): void {
    this.pinching = false;
    this.pendingFrames = 0;
  }
}
