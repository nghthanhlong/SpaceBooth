import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import {
  ControllerLock,
  DEFAULT_CONTROLLER,
  type ControllerConfig,
  type AcquireControllerOptions,
} from "./controller";
import { Emitter } from "./emitter";
import { mapFromBox, midpoint, type Box } from "./geometry";
import { FACE, HAND } from "./landmarks";
import { OneEuroFilter2D } from "./oneEuro";
import { DEFAULT_PINCH, PinchDetector, type PinchConfig } from "./pinch";
import { DEFAULT_POINT, PointDetector, type PointConfig } from "./point";
import { IdTracker } from "./tracker";
import { OwnershipResolver, DEFAULT_OWNERSHIP, type OwnershipConfig } from "./ownership";
import type { CvEventMap, FrameSize, GestureName, Point, TrackedFace, TrackedHand } from "./types";

export interface EngineConfig {
  numHands: number;
  numFaces: number;
  /** Run face landmarks every N frames (faces move slower than hands). */
  faceEveryNFrames: number;
  delegate: "GPU" | "CPU";
  wasmPath: string;
  gestureModel: string;
  faceModel: string;
  poseModel: string;
  numPoses: number;
  poseIntervalMs: number;
  ownership: OwnershipConfig;
  /** Part of the camera frame that maps to the whole stage. Smaller box = less arm movement. */
  interactionBox: Box;
  cursorFilter: { minCutoff: number; beta: number };
  pinch: PinchConfig;
  point: PointConfig;
  controller: ControllerConfig;
}

export const DEFAULT_ENGINE: EngineConfig = {
  numHands: 6,
  numFaces: 7,
  faceEveryNFrames: 2,
  delegate: "GPU",
  wasmPath: "/mediapipe/wasm",
  gestureModel: "/mediapipe/models/gesture_recognizer.task",
  faceModel: "/mediapipe/models/face_landmarker.task",
  poseModel: "/mediapipe/models/pose_landmarker_lite.task",
  numPoses: 4,
  poseIntervalMs: 100,
  ownership: DEFAULT_OWNERSHIP,
  interactionBox: { x0: 0.15, y0: 0.1, x1: 0.85, y1: 0.8 },
  cursorFilter: { minCutoff: 1.0, beta: 5.0 },
  pinch: DEFAULT_PINCH,
  point: DEFAULT_POINT,
  controller: DEFAULT_CONTROLLER,
};

/** Common interface of the real engine and the mouse mock, so the UI can swap them. */
export interface CvSource {
  on: Emitter<CvEventMap>["on"];
  start(): Promise<void>;
  stop(): void;
}

type RawHand = Omit<TrackedHand, "id">;

const mirror = (landmarks: NormalizedLandmark[]) => landmarks.map((p) => ({ ...p, x: 1 - p.x }));

/**
 * The SpaceBooth CV pipeline:
 * webcam frame -> GestureRecognizer (+ FaceLandmarker every N frames)
 * -> id tracking -> controller lock -> cursor (One-Euro) + pinch -> events.
 */
export class CvEngine extends Emitter<CvEventMap> implements CvSource {
  readonly cfg: EngineConfig;
  private gesture: GestureRecognizer | null = null;
  private face: FaceLandmarker | null = null;
  private pose: PoseLandmarker | null = null;
  private ownership: OwnershipResolver;
  private lastPoseAt = -Infinity;

  private handTracker = new IdTracker<RawHand>(0.15, 2500);
  // maxMissedMs must be >= lostTimeoutMs (2000ms) in DEFAULT_TRACKING_CONFIG so that
  // the face track stays alive long enough for useStickers to recover the same ID.
  // With faceEveryNFrames=2 there
  // is an extra ~33ms polling lag per frame, so 2500ms gives comfortable headroom.
  private faceTracker = new IdTracker<NormalizedLandmark[]>(0.15, 2500, { predictionMs: 100, deferAmbiguous: true });
  private faceTrackingActive = false;
  private controller: ControllerLock;
  private pinch: PinchDetector;
  private point: PointDetector;
  private cursorFilter: OneEuroFilter2D;

  private running = false;
  private frameCount = 0;
  private lastTimestamp = 0;
  private lastFrameAt = 0;
  private fps = 0;
  private faces: TrackedFace[] = [];
  private lastControllerId: number | null = null;
  private lastCursor: Point | null = null;

  constructor(
    private video: HTMLVideoElement,
    cfg: Partial<EngineConfig> = {},
  ) {
    super();
    this.cfg = { ...DEFAULT_ENGINE, ...cfg };
    this.controller = new ControllerLock(this.cfg.controller);
    this.ownership = new OwnershipResolver(this.cfg.ownership);
    this.pinch = new PinchDetector(this.cfg.pinch);
    this.point = new PointDetector(this.cfg.point);
    this.cursorFilter = new OneEuroFilter2D(this.cfg.cursorFilter.minCutoff, this.cfg.cursorFilter.beta);
  }

  /** Loads the models (first call only) and starts processing frames. The video must already be playing. */
  async start(): Promise<void> {
    if (!this.gesture || !this.face) {
      const vision = await FilesetResolver.forVisionTasks(this.cfg.wasmPath);
      [this.gesture, this.face] = await Promise.all([
        GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath: this.cfg.gestureModel, delegate: this.cfg.delegate },
          runningMode: "VIDEO",
          numHands: this.cfg.numHands,
        }),
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: this.cfg.faceModel, delegate: this.cfg.delegate },
          runningMode: "VIDEO",
          numFaces: this.cfg.numFaces,
        }),
      ]);
      // Pose failure must not take down camera, gestures or photo capture.
      try {
        this.pose = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: this.cfg.poseModel, delegate: this.cfg.delegate },
          runningMode: "VIDEO", numPoses: this.cfg.numPoses,
          outputSegmentationMasks: false,
        });
      } catch (error) {
        console.warn("Sticker ownership unavailable: could not load pose model", error);
      }
    }
    this.running = true;
    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    this.releaseControl();
  }

  /** Gives up control on purpose (e.g. after the photo is taken). */
  releaseControl(): void {
    this.ownership.reset();
    for (const e of this.controller.release()) this.emit(e.type, e.payload as never);
  }

  /** Configures lock acquisition options (e.g. bypass hold-time for warm re-entry). */
  acquireLock(options?: AcquireControllerOptions): void {
    this.controller.acquireLock(options);
  }

  /** Prioritize fresh face anchors while stickers are on screen. */
  setFaceTrackingActive(active: boolean): void {
    this.faceTrackingActive = active;
  }

  /** Sets controller lock mode to 'cold' (default hold time) or 'warm' (fast re-entry). */
  setControllerMode(mode: "cold" | "warm", options?: AcquireControllerOptions): void {
    const requiredHoldMs =
      mode === "warm"
        ? (options?.requiredHoldMs ?? 200)
        : (options?.requiredHoldMs ?? this.cfg.controller.dwellMs);
    this.controller.acquireLock({ requiredHoldMs });
  }

  private scheduleNextFrame() {
    if (!this.running) return;
    // requestVideoFrameCallback fires once per NEW camera frame, so we never process the same frame twice.
    if ("requestVideoFrameCallback" in this.video) {
      this.video.requestVideoFrameCallback(() => this.onFrame());
    } else {
      requestAnimationFrame(() => this.onFrame());
    }
  }

  private onFrame() {
    if (!this.running) return;
    if (this.video.readyState >= 2) this.processFrame();
    this.scheduleNextFrame();
  }

  private processFrame() {
    const gesture = this.gesture!;
    const face = this.face!;
    const t0 = performance.now();
    // MediaPipe requires strictly increasing timestamps.
    const now = Math.max(t0, this.lastTimestamp + 1);
    this.lastTimestamp = now;
    const size: FrameSize = { width: this.video.videoWidth, height: this.video.videoHeight };

    // 1. Hands + gestures
    const g = gesture.recognizeForVideo(this.video, now);
    const t1 = performance.now();
    const rawHands: RawHand[] = g.landmarks.map((lm, i) => ({
      landmarks: mirror(lm),
      gesture: (g.gestures[i]?.[0]?.categoryName ?? "None") as GestureName,
      gestureScore: g.gestures[i]?.[0]?.score ?? 0,
      handedness: g.handedness[i]?.[0]?.categoryName ?? "",
    }));
    const hands: TrackedHand[] = this.handTracker
      .update(rawHands, (h) => h.landmarks[HAND.WRIST], now)
      .map((t) => ({ id: t.id, ...t.item }));

    // 2. Faces (every N frames, the last result is reused in between)
    // With no detected hands there is nothing to associate. Avoid spending GPU
    // and main-thread time on pose while users lower their arms for the photo.
    const poseUpdated = this.pose !== null && hands.length > 0 && now - this.lastPoseAt >= this.cfg.poseIntervalMs;
    const faceUpdated = this.faceTrackingActive || poseUpdated || this.frameCount % this.cfg.faceEveryNFrames === 0;
    if (faceUpdated) {
      const f = face.detectForVideo(this.video, now);
      this.faceTracker.update(f.faceLandmarks.map(mirror), (lm) => lm[FACE.NOSE_TIP], now);
      // Keep faces missed recently (e.g. hidden by the hand placing a hat) at their last
      // position, so stickers stay on and can still be dropped onto them.
      this.faces = this.faceTracker
        .alive()
        .map((t) => ({ id: t.id, landmarks: t.item, stale: t.lastSeen !== now, lastSeen: t.lastSeen }));
    }
    const t2 = performance.now();

    if (hands.length === 0) this.ownership.observe([], this.faces, [], size, now);

    if (poseUpdated) {
      this.lastPoseAt = now;
      try {
        const poses = this.pose!.detectForVideo(this.video, now);
        this.ownership.observe(hands, this.faces, poses.landmarks.map(mirror), size, now);
      } catch (error) {
        console.warn("Sticker ownership unavailable: pose inference failed", error);
        this.pose?.close();
        this.pose = null;
        this.ownership.reset();
      }
    }
    const t3 = performance.now();

    // 3. Who is in control?
    const { controller, events } = this.controller.update(hands, now);
    if (events.some(e => e.type === "activate" || e.type === "release")) this.ownership.beginAcquisition();
    for (const e of events) this.emit(e.type, e.payload as never);

    const controllerId = controller?.id ?? null;
    if (controllerId !== this.lastControllerId) {
      if (this.pinch.isPinching && this.lastCursor) this.emit("pinchEnd", this.lastCursor);
      if (this.point.isPointing && this.lastCursor) this.emit("pointEnd", this.lastCursor);
      this.pinch.reset();
      this.point.reset();
      this.cursorFilter.reset();
      this.lastCursor = null;
      this.lastControllerId = controllerId;
    }

    // 4. Cursor, pointing and pinch for the controller only
    let cursor: Point | null = null;
    if (controller) {
      const lm = controller.landmarks;
      const pt = this.point.update(lm, size, controller.gesture, controller.gestureScore);

      // Aim from index tip when pointing; midpoint otherwise
      const aimPoint = pt.pointing ? lm[HAND.INDEX_TIP] : midpoint(lm[HAND.THUMB_TIP], lm[HAND.INDEX_TIP]);
      const raw = mapFromBox(aimPoint, this.cfg.interactionBox);
      cursor = this.cursorFilter.filter(raw, now);
      this.lastCursor = cursor;
      this.emit("cursor", cursor);

      if (pt.changed) this.emit(pt.pointing ? "pointStart" : "pointEnd", cursor);

      const p = this.pinch.update(lm, size);
      if (p.changed) this.emit(p.pinching ? "pinchStart" : "pinchEnd", cursor);
    }

    // 5. Stats
    if (this.lastFrameAt > 0) {
      const instantFps = 1000 / Math.max(t0 - this.lastFrameAt, 1);
      this.fps = this.fps === 0 ? instantFps : this.fps * 0.9 + instantFps * 0.1;
    }
    this.lastFrameAt = t0;
    this.frameCount++;

    this.emit("frame", {
      hands,
      faces: this.faces,
      controller: this.controller.publicState,
      controllerTarget: this.ownership.target(this.controller.publicState, hands, this.faces, now, this.pose !== null),
      pinching: this.pinch.isPinching,
      pointing: this.point.isPointing,
      cursor,
      pinchRatio: controller ? this.pinch.lastRatio : null,
      pointRatio: controller ? this.point.lastRatio : null,
      size,
      stats: {
        fps: this.fps,
        gestureMs: t1 - t0,
        faceMs: faceUpdated ? t2 - t1 : 0,
        poseMs: poseUpdated ? t3 - t2 : 0,
        totalMs: performance.now() - t0,
        faceUpdated,
      },
    });
  }
}
