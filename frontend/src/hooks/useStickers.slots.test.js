import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACE, placeSticker } from "spacebooth-cv";

// Exercise real hook callbacks with persistent refs, without a DOM renderer.
vi.mock("react", () => ({
  useCallback: (callback) => callback,
  useEffect: (effect) => { effect(); },
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
}));

import useStickers from "./useStickers";

const size = { width: 1280, height: 720 };
function face(id) {
  const landmarks = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[FACE.RIGHT_EYE_OUTER] = { x: 0.4, y: 0.4, z: 0 };
  landmarks[FACE.LEFT_EYE_OUTER] = { x: 0.6, y: 0.4, z: 0 };
  return { id, landmarks, stale: false };
}

const ctx = {
  save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {},
};

describe("sticker slots", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", class {
      naturalWidth = 240;
      naturalHeight = 150;
      set src(_value) { this.onload(); }
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("replaces head stickers while preserving other slots and faces", () => {
    const hook = useStickers();
    const a = face(1);
    const b = face(2);
    expect(hook.autoSnapSticker("bunnyEars", [a]).action).toBe("added");
    hook.autoSnapSticker("glasses", [a]);
    hook.autoSnapSticker("lips", [a]);
    hook.autoSnapSticker("bunnyEars", [b]);
    expect(hook.autoSnapSticker("hat", [a]).action).toBe("replaced");
    expect(hook.getTrackingStatus().placementsCount).toBe(4);
    expect(hook.autoSnapSticker("glasses", [a]).action).toBe("unchanged");
    expect(hook.autoSnapSticker("lips", [a]).action).toBe("unchanged");
    expect(hook.autoSnapSticker("bunnyEars", [b]).action).toBe("unchanged");
    expect(hook.autoSnapSticker("hat", [a]).action).toBe("unchanged");
    hook.removeSticker("1:hat");
    expect(hook.getTrackingStatus().placementsCount).toBe(3);
    expect(hook.autoSnapSticker("bunnyEars", [a]).action).toBe("added");
    hook.clearStickers();
    expect(hook.getTrackingStatus().placementsCount).toBe(0);
    expect(hook.validateSnapshotTransforms().valid).toBe(true);
  });

  it("does not change placements when no reliable face exists", () => {
    const hook = useStickers();
    hook.autoSnapSticker("bunnyEars", [face(1)]);
    expect(hook.autoSnapSticker("hat", []).success).toBe(false);
    expect(hook.autoSnapSticker("hat", [{ ...face(1), stale: true }]).success).toBe(false);
    expect(hook.autoSnapSticker("bunnyEars", [face(1)]).action).toBe("unchanged");
  });

  it("retires missing face stickers instead of transferring them to a nearby new ID", async () => {
    const hook = useStickers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    hook.autoSnapSticker("bunnyEars", [face(1)]);
    hook.drawStickers(ctx, size, [face(1)]);
    expect(hook.validateSnapshotTransforms().valid).toBe(true);

    hook.drawStickers(ctx, size, [face(9)]);
    expect(hook.getDebugInfo().preservedTransforms).toEqual([]);
    expect(hook.getTrackingStatus().placementsCount).toBe(0);
    expect(hook.validateSnapshotTransforms().transforms).toEqual([]);
    expect(hook.autoSnapSticker("hat", [face(9)]).action).toBe("added");
    expect(hook.getDebugInfo().preservedTransforms).toEqual([]);
    expect(hook.validateSnapshotTransforms().valid).toBe(false);

    hook.drawStickers(ctx, size, [face(9)]);
    const snapshot = hook.validateSnapshotTransforms();
    expect(snapshot.valid).toBe(true);
    expect(snapshot.transforms).toHaveLength(1);
    expect(snapshot.transforms[0]).toMatchObject({ faceId: 9, kind: "hat" });
    hook.removeSticker("9:hat");
    expect(hook.getDebugInfo().preservedTransforms).toEqual([]);
    expect(hook.getTrackingStatus().placementsCount).toBe(0);
  });

  it("uses an explicit face ID and never falls back to another visible face", () => {
    const hook = useStickers();
    const faces = [face(1), face(2)];
    expect(hook.autoSnapSticker("hat", faces).success).toBe(false);
    expect(hook.autoSnapSticker("hat", faces, 2)).toMatchObject({ success: true, faceId: 2 });
    expect(hook.autoSnapSticker("glasses", [face(1)], 2).success).toBe(false);
    expect(hook.autoSnapSticker("glasses", [{ ...face(2), stale: true }], 2).success).toBe(false);
  });

  it("excludes a retired track from snapshot validation immediately", async () => {
    const hook = useStickers();
    await new Promise(resolve => setTimeout(resolve, 0));
    hook.autoSnapSticker("hat", [face(1)]);
    hook.drawStickers(ctx, size, [face(1)]);
    expect(hook.validateSnapshotTransforms([face(9)]).transforms).toEqual([]);
    hook.drawStickers(ctx, size, [face(9)], false, { snapshot: true });
    expect(hook.getTrackingStatus().placementsCount).toBe(0);
  });

  it("does not make cached detections fresh by repainting them", async () => {
    const hook = useStickers();
    await new Promise(resolve => setTimeout(resolve, 0));
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const a = { ...face(1), lastSeen: 0 };
    hook.autoSnapSticker("hat", [a]);
    hook.drawStickers(ctx, size, [a]);
    clock.mockReturnValue(200);
    hook.drawStickers(ctx, size, [a]);
    expect(hook.getDebugInfo().preservedTransforms[0].ageMs).toBe(200);
    clock.mockReturnValue(301);
    const draw = { ...ctx, drawImage: vi.fn() };
    hook.drawStickers(draw, size, [a]);
    expect(draw.drawImage).not.toHaveBeenCalled();
    expect(hook.validateSnapshotTransforms([a]).valid).toBe(false);
  });

  it("reattaches immediately after a brief loss, without a recovery glide", async () => {
    const hook = useStickers();
    await new Promise(resolve => setTimeout(resolve, 0));
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const a = { ...face(1), lastSeen: 0 };
    hook.autoSnapSticker("glasses", [a]);
    hook.drawStickers(ctx, size, [a]);
    clock.mockReturnValue(100);
    hook.drawStickers(ctx, size, [{ ...a, stale: true }]);
    const moved = { ...a, lastSeen: 150,
      landmarks: a.landmarks.map(p => ({ ...p, x: p.x + 0.05 })) };
    clock.mockReturnValue(150);
    const draw = { ...ctx, translate: vi.fn() };
    hook.drawStickers(draw, size, [moved]);
    expect(draw.translate).toHaveBeenLastCalledWith(placeSticker(moved, "glasses", size).x,
      placeSticker(moved, "glasses", size).y);
  });

  it("exports measured anchors without live smoothing or the sticker pop animation", async () => {
    const hook = useStickers();
    await new Promise(resolve => setTimeout(resolve, 0));
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const a = { ...face(1), lastSeen: 0 };
    hook.autoSnapSticker("hat", [a]);
    hook.drawStickers(ctx, size, [a]);
    const moved = { ...a, lastSeen: 33,
      landmarks: a.landmarks.map(p => ({ ...p, x: p.x + 0.001 })) };
    clock.mockReturnValue(33);
    const draw = { ...ctx, translate: vi.fn(), drawImage: vi.fn() };
    hook.drawStickers(draw, size, [moved]);
    const raw = placeSticker(moved, "hat", size);
    expect(draw.translate.mock.lastCall[0]).toBeLessThan(raw.x);
    hook.drawStickers(draw, size, [moved], false, { snapshot: true });
    expect(draw.translate).toHaveBeenLastCalledWith(raw.x, raw.y);
    expect(draw.drawImage.mock.lastCall[3]).toBe(raw.width);
  });
});
