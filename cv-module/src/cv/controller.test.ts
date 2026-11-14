import { describe, it, expect, beforeEach } from "vitest";
import { ControllerLock } from "./controller";
import type { GestureName, TrackedHand } from "./types";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

function mockHand(
  id: number,
  gesture: GestureName = "Open_Palm",
  score = 0.9,
  x = 0.5,
  y = 0.5,
): TrackedHand {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({
    x,
    y,
    z: 0,
    visibility: 1,
  }));
  return {
    id,
    landmarks,
    gesture,
    gestureScore: score,
    handedness: "Right",
  };
}

describe("ControllerLock", () => {
  let lock: ControllerLock;

  beforeEach(() => {
    lock = new ControllerLock();
  });

  describe("Task 3.5: Multi-person open palm conflict", () => {
    it("when 2 people show open palm simultaneously, only 1 acquires the lock", () => {
      const hand1 = mockHand(1, "Open_Palm");
      const hand2 = mockHand(2, "Open_Palm");

      // Frame 1 at t=0
      const r1 = lock.update([hand1, hand2], 0);
      expect(lock.publicState.kind).toBe("arming");
      expect((lock.publicState as { handId: number }).handId).toBe(1);
      expect(r1.controller).toBeNull();

      // Advance past dwellMs (1500ms) with both hands still present
      const r2 = lock.update([hand1, hand2], 1500);
      expect(lock.publicState.kind).toBe("locked");
      expect((lock.publicState as { handId: number }).handId).toBe(1);
      expect(r2.controller?.id).toBe(1);

      // Verify activate event was emitted specifically for hand 1
      const activateEvt = r2.events.find((e) => e.type === "activate");
      expect(activateEvt).toBeDefined();
      expect(activateEvt?.payload).toEqual({ handId: 1 });
    });
  });

  describe("Task 3.5: Warm re-entry hold-time bypass", () => {
    it("default cold mode requires 1.5s hold time", () => {
      const hand = mockHand(1, "Open_Palm");

      lock.update([hand], 0);
      expect(lock.publicState.kind).toBe("arming");

      // At 500ms -> still arming
      const mid = lock.update([hand], 500);
      expect(lock.publicState.kind).toBe("arming");
      expect(mid.controller).toBeNull();

      // At 1500ms -> locked
      const end = lock.update([hand], 1500);
      expect(lock.publicState.kind).toBe("locked");
      expect(end.controller?.id).toBe(1);
    });

    it("calling acquireLock with requiredHoldMs=0 locks immediately on first frame", () => {
      lock.acquireLock({ requiredHoldMs: 0 });
      const hand = mockHand(1, "Open_Palm");

      const res = lock.update([hand], 0);
      expect(lock.publicState.kind).toBe("locked");
      expect(res.controller?.id).toBe(1);
      expect(res.events).toContainEqual({
        type: "activate",
        payload: { handId: 1 },
      });
    });

    it("calling acquireLock with low requiredHoldMs (100ms) locks quickly without waiting 1.5s", () => {
      lock.acquireLock({ requiredHoldMs: 100 });
      const hand = mockHand(1, "Open_Palm");

      // At 0ms -> arming
      const r0 = lock.update([hand], 0);
      expect(lock.publicState.kind).toBe("arming");
      expect(r0.controller).toBeNull();

      // At 50ms -> arming
      lock.update([hand], 50);
      expect(lock.publicState.kind).toBe("arming");

      // At 100ms -> locked!
      const r2 = lock.update([hand], 100);
      expect(lock.publicState.kind).toBe("locked");
      expect(r2.controller?.id).toBe(1);
      expect(r2.events).toContainEqual({
        type: "activate",
        payload: { handId: 1 },
      });
    });
  });

  describe("Task 3.4 & 3.5: Release timeout and multi-person isolation", () => {
    it("after acquiring lock in warm mode, release timeout still uses lostTimeoutMs (1500ms)", () => {
      // Warm re-entry
      lock.acquireLock({ requiredHoldMs: 100 });
      const hand = mockHand(1, "Open_Palm");
      lock.update([hand], 0);
      lock.update([hand], 100);
      expect(lock.publicState.kind).toBe("locked");

      // Hand disappears at t=200
      const missing1 = lock.update([], 200);
      expect(lock.publicState.kind).toBe("locked");
      expect(missing1.controller).toBeNull();

      // At t=1200 (1000ms missing, less than lostTimeoutMs 1500ms) -> still locked!
      const missing2 = lock.update([], 1200);
      expect(lock.publicState.kind).toBe("locked");
      expect(missing2.events.some((e) => e.type === "release")).toBe(false);

      // Hand reappears at t=1300 -> retains control seamlessly
      const recovered = lock.update([hand], 1300);
      expect(lock.publicState.kind).toBe("locked");
      expect(recovered.controller?.id).toBe(1);

      // Hand disappears again at t=1400
      lock.update([], 1400);

      // Advance to t=2901 (1501ms missing > lostTimeoutMs) -> released!
      const released = lock.update([], 2901);
      expect(lock.publicState.kind).toBe("idle");
      expect(released.controller).toBeNull();
      expect(released.events).toContainEqual({
        type: "release",
        payload: { handId: 1, reason: "lost" },
      });
    });

    it("Task 3.4 scenario: bystander hands waving in background do not steal control from current controller", () => {
      const controllerHand = mockHand(1, "Open_Palm");
      const bystander1 = mockHand(2, "Open_Palm");
      const bystander2 = mockHand(3, "Pointing_Up");

      // Controller hand locks
      lock.update([controllerHand], 0);
      lock.update([controllerHand], 1500);
      expect(lock.publicState.kind).toBe("locked");

      // 2 bystanders wave their hands in view
      const r = lock.update([controllerHand, bystander1, bystander2], 1600);
      expect(lock.publicState.kind).toBe("locked");
      expect(r.controller?.id).toBe(1); // Control stays strictly with hand 1!
      expect(r.events.some((e) => e.type === "activate" || e.type === "release")).toBe(false);

      // Controller hand changes gesture to Pointing_Up (operating cursor)
      const controllerPointing = mockHand(1, "Pointing_Up");
      const r2 = lock.update([controllerPointing, bystander1], 1700);
      expect(r2.controller?.id).toBe(1);
    });
  });
});
