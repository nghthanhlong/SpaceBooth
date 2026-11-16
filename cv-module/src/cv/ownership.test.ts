import { describe, it, expect } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { OwnershipResolver } from "./ownership";
import { FACE } from "./landmarks";
import type { ControllerState, TrackedFace, TrackedHand } from "./types";

const size = { width: 1280, height: 720 };
const point = (x: number, y: number, visibility = 1): NormalizedLandmark => ({ x, y, z: 0, visibility });
function person(id: number, x: number, wristX = x) {
  const landmarks = Array.from({ length: 478 }, () => point(x, 0.25));
  landmarks[FACE.RIGHT_EYE_OUTER] = point(x - 0.04, 0.22);
  landmarks[FACE.LEFT_EYE_OUTER] = point(x + 0.04, 0.22);
  const face: TrackedFace = { id, stale: false, landmarks };
  const pose = Array.from({ length: 33 }, () => point(x, 0.25));
  pose[11] = point(x - 0.1, 0.5);
  pose[12] = point(x + 0.1, 0.5);
  pose[15] = point(wristX, 0.4);
  pose[16] = point(x + 0.1, 0.65);
  const hand: TrackedHand = { id, landmarks: Array.from({ length: 21 }, () => point(wristX, 0.4)),
    gesture: "Open_Palm", gestureScore: 1, handedness: "Left" };
  return { face, pose, hand };
}
const locked = (handId: number): ControllerState => ({ kind: "locked", handId });

describe("body ownership", () => {
  it("uses the body's wrist, not the face nearest the hand, even with crossed arms", () => {
    const a = person(1, 0.3, 0.7), b = person(2, 0.7, 0.3);
    const resolver = new OwnershipResolver();
    for (const now of [0, 100, 200]) {
      const poses = now === 100 ? [b.pose, a.pose] : [a.pose, b.pose];
      resolver.observe([a.hand, b.hand], [a.face, b.face], poses, size, now);
    }
    expect(resolver.target(locked(1), [a.hand, b.hand], [a.face, b.face], 200, true))
      .toMatchObject({ status: "confirmed", handId: 1, faceId: 1 });
    resolver.beginAcquisition();
    expect(resolver.target(locked(2), [a.hand, b.hand], [a.face, b.face], 200, true))
      .toMatchObject({ status: "confirmed", handId: 2, faceId: 2 });
  });

  it("requires three distinct observations and expires evidence", () => {
    const a = person(1, 0.3), resolver = new OwnershipResolver();
    const observe = (now: number) => resolver.observe([a.hand], [a.face], [a.pose], size, now);
    const target = (now: number) => resolver.target(locked(1), [a.hand], [a.face], now, true);
    observe(0); observe(0); observe(200);
    expect(target(200).status).toBe("pending");
    observe(300);
    expect(target(300).status).toBe("confirmed");
    expect(target(650).status).toBe("confirmed");
    expect(target(651).status).toBe("pending");
    expect(resolver.target(locked(1), [], [a.face], 300, true).status).toBe("pending");
    expect(resolver.target(locked(1), [a.hand], [{ ...a.face, stale: true }], 300, true).status).toBe("pending");
  });

  it("does not transfer a locked target when the association changes", () => {
    const a = person(1, 0.3), resolver = new OwnershipResolver();
    for (const now of [0, 100, 200]) resolver.observe([a.hand], [a.face], [a.pose], size, now);
    expect(resolver.target(locked(1), [a.hand], [a.face], 200, true).faceId).toBe(1);
    const newFace = { ...a.face, id: 9 };
    for (const now of [300, 400, 500]) resolver.observe([a.hand], [newFace], [a.pose], size, now);
    expect(resolver.target(locked(1), [a.hand], [newFace], 500, true))
      .toMatchObject({ status: "ambiguous", faceId: null });
    resolver.beginAcquisition();
    expect(resolver.target(locked(1), [a.hand], [newFace], 500, true).faceId).toBe(9);
    resolver.reset();
    expect(resolver.target(locked(1), [a.hand], [newFace], 500, true).status).toBe("pending");
    expect(resolver.target(locked(1), [a.hand], [newFace], 500, false).status).toBe("unavailable");
  });

  it.each(["wrist", "face", "visibility", "noPose"])("rejects ambiguous or missing evidence: %s", mode => {
    const a = person(1, 0.3), resolver = new OwnershipResolver();
    const hands = mode === "wrist" ? [a.hand, { ...a.hand, id: 2 }] : [a.hand];
    const faces = mode === "face" ? [a.face, { ...a.face, id: 2 }] : [a.face];
    if (mode === "visibility") a.pose[11].visibility = 0.2;
    for (const now of [0, 100, 200]) resolver.observe(hands, faces, mode === "noPose" ? [] : [a.pose], size, now);
    expect(resolver.target(locked(1), hands, faces, 200, true).status).not.toBe("confirmed");
  });

  it("starts over after an interrupted observation or new hand ID", () => {
    const a = person(1, 0.3), resolver = new OwnershipResolver();
    for (const now of [0, 100, 200]) resolver.observe([a.hand], [a.face], [a.pose], size, now);
    resolver.observe([], [a.face], [], size, 300);
    resolver.observe([a.hand], [a.face], [a.pose], size, 400);
    expect(resolver.target(locked(1), [a.hand], [a.face], 400, true).status).toBe("pending");
    const newHand = { ...a.hand, id: 2 };
    resolver.observe([newHand], [a.face], [a.pose], size, 500);
    expect(resolver.target(locked(2), [newHand], [a.face], 500, true).status).toBe("pending");
  });

  it("associates four people independently of detection order", () => {
    const people = [0.15, 0.38, 0.62, 0.85].map((x, i) => person(i + 1, x));
    const resolver = new OwnershipResolver();
    const hands = people.map(p => p.hand), faces = people.map(p => p.face);
    for (const now of [0, 100, 200]) {
      resolver.observe([...hands].reverse(), faces, people.map(p => p.pose).reverse(), size, now);
    }
    for (const p of people) {
      resolver.beginAcquisition();
      expect(resolver.target(locked(p.hand.id), hands, faces, 200, true))
        .toMatchObject({ status: "confirmed", faceId: p.face.id });
    }
  });
});
