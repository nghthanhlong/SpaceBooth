import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACE } from "spacebooth-cv";

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
  afterEach(() => vi.unstubAllGlobals());

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

  it("cleans replaced transforms and uses the current face ID after re-identification", async () => {
    const hook = useStickers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    hook.autoSnapSticker("bunnyEars", [face(1)]);
    hook.drawStickers(ctx, size, [face(1)]);
    expect(hook.validateSnapshotTransforms().valid).toBe(true);

    hook.drawStickers(ctx, size, [face(9)]);
    expect(hook.getDebugInfo().preservedTransforms[0].faceId).toBe(9);
    expect(hook.autoSnapSticker("hat", [face(9)]).action).toBe("replaced");
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
});
