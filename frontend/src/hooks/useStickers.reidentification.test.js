/**
 * Unit tests for position-based re-identification logic in useStickers.js.
 *
 * Strategy: Extract the pure functions (toPx, dist, isTransformFinite) and
 * replicate the re-id block as a testable pure function so we can verify
 * behavior without spinning up React / canvas.
 *
 * The function under test mirrors the exact logic block inserted above
 * `isFaceActive` in drawStickers (lines 279-298 of useStickers.js).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FACE } from "spacebooth-cv";

// ─── Pure helpers (duplicated from useStickers.js to keep tests self-contained) ─

function toPx(point, size) {
  return { x: point.x * size.width, y: point.y * size.height };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isTransformFinite(pose) {
  return (
    pose &&
    Number.isFinite(pose.x) &&
    Number.isFinite(pose.y) &&
    Number.isFinite(pose.width) &&
    Number.isFinite(pose.angle) &&
    pose.width > 0
  );
}

// ─── Re-identification logic (mirrors drawStickers block verbatim) ─────────────

/**
 * Runs one iteration of the re-identification block from drawStickers.
 *
 * @param {object} item           - Placement item with mutable `faceId`
 * @param {object[]} faces        - Current faces array (may include stale)
 * @param {Map} preservedMap      - preservedTransformsRef.current (by item.id)
 * @param {{ width: number, height: number }} size  - Canvas pixel size
 * @returns {{ face: object|undefined, item: object }} - Updated face & item
 */
function runReidentification(item, faces, preservedMap, size) {
  let face = faces.find((candidate) => candidate.id === item.faceId);

  if (!face) {
    const preservedEarly = preservedMap.get(item.id);
    if (preservedEarly && preservedEarly.faceCenter && isTransformFinite(preservedEarly)) {
      const radius = Math.max(preservedEarly.eyeDistance * 1.5, 120);
      const reidentified = faces.find((f) => {
        if (f.stale || !f.landmarks || !f.landmarks.length) return false;
        const nosePx = toPx(f.landmarks[FACE.NOSE_TIP], size);
        return dist(nosePx, preservedEarly.faceCenter) <= radius;
      });
      if (reidentified) {
        face = reidentified;
        item.faceId = reidentified.id;
      }
    }
  }

  return { face, item };
}

// ─── Helpers for building mock faces ─────────────────────────────────────────

const SIZE = { width: 1280, height: 720 };

/**
 * Build a minimal landmark array large enough to hold FACE.NOSE_TIP (index 1)
 * and FACE.LEFT_EYE_OUTER (index 263) as normalised [0,1] coordinates.
 *
 * We only fill the indices we actually use in re-identification.
 */
function makeLandmarks(nosePxX, nosePxY) {
  const landmarks = new Array(300).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  landmarks[FACE.NOSE_TIP] = { x: nosePxX / SIZE.width, y: nosePxY / SIZE.height, z: 0 };
  return landmarks;
}

function makeFace(id, nosePxX, nosePxY, { stale = false } = {}) {
  return {
    id,
    stale,
    landmarks: makeLandmarks(nosePxX, nosePxY),
  };
}

/**
 * Build a preserved transform that simulates what useStickers writes after
 * N active tracking frames with a nose at (nosePxX, nosePxY) and a known
 * eye-distance.
 */
function makePreserved({ nosePxX, nosePxY, eyeDistance = 100 } = {}) {
  return {
    x: nosePxX,
    y: nosePxY - 40,
    width: 80,
    angle: 0,
    faceCenter: { x: nosePxX, y: nosePxY },
    eyeDistance,
    lastValidTime: performance.now(),
    trackingState: "TEMPORARY_HOLD",
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("useStickers — position-based re-identification", () => {
  const ITEM_ID = "face-A:hat";
  const KIND = "hat";

  // Position X used in all tests
  const NOSE_X = 640;
  const NOSE_Y = 360;
  const EYE_DISTANCE = 100; // radius = max(100 * 1.5, 120) = 150 px

  let preservedMap;
  let item;

  beforeEach(() => {
    preservedMap = new Map();
    item = { id: ITEM_ID, faceId: "face-A", kind: KIND };
  });

  // ── Positive test ───────────────────────────────────────────────────────────

  it("re-identifies sticker to face-B when face-A is gone and face-B is within radius", () => {
    // Simulate N frames where face-A was tracked and preserved transform is saved.
    preservedMap.set(ITEM_ID, makePreserved({ nosePxX: NOSE_X, nosePxY: NOSE_Y, eyeDistance: EYE_DISTANCE }));

    // face-A is completely gone from the faces array (IdTracker purged it).
    // face-B appears very close to position X (within 150 px radius).
    const faceB = makeFace("face-B", NOSE_X + 40, NOSE_Y + 20); // dist ≈ 44.7 px — well within 150

    const faces = [faceB];
    const { face, item: updatedItem } = runReidentification(item, faces, preservedMap, SIZE);

    // Sticker should now be associated with face-B
    expect(face).toBeDefined();
    expect(face.id).toBe("face-B");
    expect(updatedItem.faceId).toBe("face-B");
  });

  it("re-identification works across a simulated N+M frame gap (face fully absent for M frames)", () => {
    // Phase 1 (N frames): face-A tracked — preserved transform recorded.
    preservedMap.set(ITEM_ID, makePreserved({ nosePxX: NOSE_X, nosePxY: NOSE_Y, eyeDistance: EYE_DISTANCE }));

    // Phase 2 (M frames): simulate the M frames where the faces array is empty.
    for (let frame = 0; frame < 5; frame++) {
      const { face } = runReidentification(item, [], preservedMap, SIZE);
      expect(face).toBeUndefined(); // No re-id possible — no candidates
      // faceId stays as "face-A" because no match found
      expect(item.faceId).toBe("face-A");
    }

    // Phase 3: face-B appears near original position.
    const faceB = makeFace("face-B", NOSE_X - 30, NOSE_Y + 10); // dist ≈ 31.6 px
    const { face, item: updatedItem } = runReidentification(item, [faceB], preservedMap, SIZE);

    expect(face).toBeDefined();
    expect(face.id).toBe("face-B");
    expect(updatedItem.faceId).toBe("face-B");
  });

  it("subsequent frames skip re-id search once faceId is updated to face-B", () => {
    preservedMap.set(ITEM_ID, makePreserved({ nosePxX: NOSE_X, nosePxY: NOSE_Y, eyeDistance: EYE_DISTANCE }));
    const faceB = makeFace("face-B", NOSE_X + 40, NOSE_Y + 20);

    // Frame that re-identifies
    runReidentification(item, [faceB], preservedMap, SIZE);
    expect(item.faceId).toBe("face-B");

    // Next frame: faces array now contains face-B; direct find should succeed.
    const { face } = runReidentification(item, [faceB], preservedMap, SIZE);
    expect(face).toBeDefined();
    expect(face.id).toBe("face-B");
  });

  // ── Negative test ───────────────────────────────────────────────────────────

  it("does NOT re-identify when face-B is beyond the radius threshold", () => {
    preservedMap.set(ITEM_ID, makePreserved({ nosePxX: NOSE_X, nosePxY: NOSE_Y, eyeDistance: EYE_DISTANCE }));

    // face-B is far away — dist ≈ 212 px > radius 150 px
    const faceBFar = makeFace("face-B", NOSE_X + 150, NOSE_Y + 150);
    const faces = [faceBFar];

    const { face, item: updatedItem } = runReidentification(item, faces, preservedMap, SIZE);

    // No match — sticker should fall through to the TEMPORARY_HOLD / TRACKING_LOST branch
    expect(face).toBeUndefined();
    // faceId should NOT have been mutated to face-B's id
    expect(updatedItem.faceId).toBe("face-A");
  });

  it("does NOT re-identify when candidate face is marked stale", () => {
    preservedMap.set(ITEM_ID, makePreserved({ nosePxX: NOSE_X, nosePxY: NOSE_Y, eyeDistance: EYE_DISTANCE }));

    // face-B is close but stale
    const faceBStale = makeFace("face-B", NOSE_X + 10, NOSE_Y + 5, { stale: true });
    const { face, item: updatedItem } = runReidentification(item, [faceBStale], preservedMap, SIZE);

    expect(face).toBeUndefined();
    expect(updatedItem.faceId).toBe("face-A");
  });

  it("does NOT re-identify when no preserved transform exists yet", () => {
    // preservedMap is empty (sticker placed but never tracked)
    const faceB = makeFace("face-B", NOSE_X + 10, NOSE_Y + 5);
    const { face, item: updatedItem } = runReidentification(item, [faceB], preservedMap, SIZE);

    expect(face).toBeUndefined();
    expect(updatedItem.faceId).toBe("face-A");
  });

  it("does NOT re-identify when preserved transform has non-finite values", () => {
    preservedMap.set(ITEM_ID, {
      x: NaN,
      y: NaN,
      width: 0,
      angle: 0,
      faceCenter: { x: NOSE_X, y: NOSE_Y },
      eyeDistance: EYE_DISTANCE,
      lastValidTime: performance.now(),
    });

    const faceB = makeFace("face-B", NOSE_X + 10, NOSE_Y + 5);
    const { face, item: updatedItem } = runReidentification(item, [faceB], preservedMap, SIZE);

    expect(face).toBeUndefined();
    expect(updatedItem.faceId).toBe("face-A");
  });

  // ── Radius edge cases ───────────────────────────────────────────────────────

  it("applies minimum radius of 120 px when eyeDistance * 1.5 < 120", () => {
    // eyeDistance = 60 → 60 * 1.5 = 90 → radius clamped to 120
    preservedMap.set(ITEM_ID, makePreserved({ nosePxX: NOSE_X, nosePxY: NOSE_Y, eyeDistance: 60 }));

    // Face at exactly 115 px — within 120 px minimum radius
    const faceNear = makeFace("face-B", NOSE_X + 115, NOSE_Y);
    const { face: faceFound } = runReidentification(item, [faceNear], preservedMap, SIZE);
    expect(faceFound).toBeDefined();
    expect(faceFound.id).toBe("face-B");

    // Reset and try at 125 px — just outside 120 px minimum radius
    item.faceId = "face-A";
    const faceFar = makeFace("face-C", NOSE_X + 125, NOSE_Y);
    const { face: faceNotFound } = runReidentification(item, [faceFar], preservedMap, SIZE);
    expect(faceNotFound).toBeUndefined();
  });
});
