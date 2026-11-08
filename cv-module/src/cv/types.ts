import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface Point {
  x: number;
  y: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

/** Built-in gestures of the MediaPipe GestureRecognizer model. */
export type GestureName =
  | "None"
  | "Closed_Fist"
  | "Open_Palm"
  | "Pointing_Up"
  | "Thumb_Down"
  | "Thumb_Up"
  | "Victory"
  | "ILoveYou";

/**
 * A hand with a stable id across frames.
 * Landmarks are normalized [0,1] and already MIRRORED (x = 1 - x),
 * so they match a selfie-style (mirrored) video on screen.
 */
export interface TrackedHand {
  id: number;
  landmarks: NormalizedLandmark[];
  gesture: GestureName;
  gestureScore: number;
  /** Raw MediaPipe label. Note: MediaPipe assumes a mirrored input, so this may be flipped. */
  handedness: string;
}

export type FaceTrackingState =
  | "TRACKING"
  | "TEMPORARY_HOLD"
  | "RECOVERY"
  | "TRACKING_LOST";

export interface TrackingConfig {
  /** 0–300ms: short tracking interruption; preserve the last valid transform. */
  shortInterruptionMs: number;
  /** 300–1000ms: temporary hold. */
  temporaryHoldMs: number;
  /** 1000–2000ms: non-blocking warning threshold. */
  warningTimeoutMs: number;
  /** Beyond 2000ms: show tracking-lost warning / pause countdown. */
  lostTimeoutMs: number;
  /** Duration in ms for smooth interpolation when recovering tracking. */
  recoveryInterpolationDurationMs: number;
  /** Period in ms that tracking must remain stable before resuming countdown. */
  recoveryStabilityMs: number;
  /** Maximum transform age in ms permitted for fallback snapshot rendering. */
  maxSnapshotTransformAgeMs: number;
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  shortInterruptionMs: 300,
  temporaryHoldMs: 1000,
  warningTimeoutMs: 2000,
  lostTimeoutMs: 2000,
  recoveryInterpolationDurationMs: 250,
  recoveryStabilityMs: 500,
  maxSnapshotTransformAgeMs: 3000,
};

export interface PreservedStickerTransform {
  faceId: number;
  stickerId: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  angle: number;
  lastValidTime: number;
  trackingState: FaceTrackingState;
  faceCenter?: Point;
  eyeDistance?: number;
}

/** A face with a stable id across frames. Landmarks are normalized and mirrored. */
export interface TrackedFace {
  id: number;
  landmarks: NormalizedLandmark[];
  /** True when not detected in the latest face pass; landmarks are from the last detection. */
  stale: boolean;
}

export type ControllerState =
  | { kind: "idle" }
  | { kind: "arming"; handId: number; progress: number }
  | { kind: "locked"; handId: number };

export interface FrameStats {
  fps: number;
  gestureMs: number;
  faceMs: number;
  totalMs: number;
  faceUpdated: boolean;
}

export interface FrameInfo {
  hands: TrackedHand[];
  faces: TrackedFace[];
  controller: ControllerState;
  pinching: boolean;
  pointing: boolean;
  /** Normalized cursor position on the stage, null when nobody is in control. */
  cursor: Point | null;
  pinchRatio: number | null;
  pointRatio?: number | null;
  stats: FrameStats;
  size: FrameSize;
}

/** Every event the CV module emits. The UI only needs to listen to these. */
export interface CvEventMap {
  /** Normalized [0,1] position over the displayed video stage. */
  cursor: Point;
  pinchStart: Point;
  pinchEnd: Point;
  pointStart: Point;
  pointEnd: Point;
  /** Progress [0,1] of the open-palm dwell that grants control. 0 means cancelled. */
  dwellProgress: { handId: number; progress: number };
  activate: { handId: number };
  release: { handId: number; reason: "lost" | "manual" };
  /** Progress [0,1] of holding the Victory gesture. 0 means cancelled. */
  captureProgress: { progress: number; victoryHands: number };
  /** Victory held long enough: the countdown before the photo begins. */
  countdownStart: { durationMs: number; victoryHands: number };
  /** Emitted at the start of the countdown and every second after (secondsLeft >= 1). */
  countdown: { secondsLeft: number };
  /** Countdown finished: take the photo now (use the landmarks of this frame). */
  capture: { victoryHands: number };
  /** Emitted once per processed frame, mainly for debug overlays. */
  frame: FrameInfo;
}

export type CvEvent = {
  [K in keyof CvEventMap]: { type: K; payload: CvEventMap[K] };
}[keyof CvEventMap];
