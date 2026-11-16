import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACE } from "./landmarks";
import type { FrameInfo } from "./types";
import { CvEngine, DEFAULT_ENGINE } from "./engine";

const models = vi.hoisted(() => ({
  gesture: vi.fn(), face: vi.fn(), pose: vi.fn(), loadPose: vi.fn(), closePose: vi.fn(),
}));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  GestureRecognizer: { createFromOptions: vi.fn(async () => ({ recognizeForVideo: models.gesture })) },
  FaceLandmarker: { createFromOptions: vi.fn(async () => ({ detectForVideo: models.face })) },
  PoseLandmarker: { createFromOptions: models.loadPose },
}));
const p = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });

describe("ownership pipeline", () => {
  beforeEach(() => {
    models.loadPose.mockResolvedValue({ detectForVideo: models.pose, close: models.closePose });
    models.gesture.mockReturnValue({ landmarks: [Array.from({ length: 21 }, () => p(0.3, 0.4))],
      gestures: [[{ categoryName: "Open_Palm", score: 1 }]], handedness: [[{ categoryName: "Left" }]] });
    const face = Array.from({ length: 478 }, () => p(0.3, 0.25));
    face[FACE.LEFT_EYE_OUTER] = p(0.34, 0.22);
    face[FACE.RIGHT_EYE_OUTER] = p(0.26, 0.22);
    models.face.mockReturnValue({ faceLandmarks: [face] });
    const pose = Array.from({ length: 33 }, () => p(0.3, 0.25));
    pose[11] = p(0.2, 0.5); pose[12] = p(0.4, 0.5);
    pose[15] = p(0.3, 0.4); pose[16] = p(0.4, 0.65);
    models.pose.mockReturnValue({ landmarks: [pose] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  function engine() {
    const video = { videoWidth: 1280, videoHeight: 720, requestVideoFrameCallback: vi.fn() };
    const engine = new CvEngine(video as unknown as HTMLVideoElement, {
      controller: { ...DEFAULT_ENGINE.controller, dwellMs: 200 },
    });
    const frames: FrameInfo[] = [];
    engine.on("frame", frame => frames.push(frame));
    const tick = (now: number) => {
      vi.spyOn(performance, "now").mockReturnValue(now);
      (engine as unknown as { processFrame(): void }).processFrame();
    };
    return { engine, frames, tick };
  }

  it("publishes a confirmed target without changing acquisition timing, and resets on stop", async () => {
    const { engine: e, frames, tick } = engine();
    await e.start();
    tick(1); tick(101); tick(201);
    expect(frames[0].controller.kind).toBe("arming");
    expect(frames[2].controllerTarget).toMatchObject({ status: "confirmed", faceId: 1, handId: 1 });
    tick(250);
    expect(models.pose).toHaveBeenCalledTimes(3);
    expect(frames[3].stats.poseMs).toBe(0);
    e.stop();
    tick(301);
    expect(frames[4].controllerTarget.status).toBe("pending");
    expect(frames[4].controller.kind).toBe("arming");
  });

  it("keeps gestures and frames available when the pose model cannot load", async () => {
    models.loadPose.mockRejectedValueOnce(new Error("offline"));
    const { engine: e, frames, tick } = engine();
    await expect(e.start()).resolves.toBeUndefined();
    tick(1); tick(201);
    expect(frames[1].controller.kind).toBe("locked");
    expect(frames[1].controllerTarget.status).toBe("unavailable");
    expect(frames[1].faces).toHaveLength(1);
    e.stop();
  });

  it("disables ownership safely after an inference failure", async () => {
    models.pose.mockImplementationOnce(() => { throw new Error("GPU failure"); });
    const { engine: e, frames, tick } = engine();
    await e.start(); tick(1); tick(201);
    expect(frames[1].controllerTarget.status).toBe("unavailable");
    expect(models.closePose).toHaveBeenCalledTimes(1);
    expect(models.pose).toHaveBeenCalledTimes(1);
    e.stop();
  });

  it("prioritizes face detections with stickers and skips pose when arms are lowered", async () => {
    const { engine: e, frames, tick } = engine();
    await e.start();
    tick(1);
    e.setFaceTrackingActive(true);
    models.gesture.mockReturnValue({ landmarks: [], gestures: [], handedness: [] });
    tick(51); tick(201);
    expect(models.face).toHaveBeenCalledTimes(3);
    expect(models.pose).toHaveBeenCalledTimes(1);
    expect(frames[2].faces[0].lastSeen).toBe(201);
    expect(frames[2].stats.poseMs).toBe(0);
    e.setFaceTrackingActive(false);
    tick(251);
    expect(models.face).toHaveBeenCalledTimes(3);
    expect(frames[3].faces[0].lastSeen).toBe(201);
    e.stop();
  });
});
