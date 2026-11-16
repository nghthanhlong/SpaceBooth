import { describe, it, expect, beforeEach } from "vitest";
import { ControllerLock, DEFAULT_CONTROLLER } from "./controller";
import { CvEngine } from "./engine";
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

  describe("automatic interaction session", () => {
    function activate() {
      lock.update([mockHand(1)], 0);
      expect(lock.update([mockHand(1)], 200).controller).toBeNull();
      expect(lock.update([mockHand(1)], 1499).controller).toBeNull();
      expect(lock.update([mockHand(1)], 1500).controller?.id).toBe(1);
    }

    it("uses cold dwell initially and fast dwell for repeated acquisitions with new IDs", () => {
      activate();
      let lastSeen = 1500;
      for (const id of [2, 3, 4]) {
        lock.update([], lastSeen + 1501);
        lock.update([mockHand(id)], lastSeen + 1600);
        expect(lock.update([mockHand(id)], lastSeen + 1799).controller).toBeNull();
        const result = lock.update([mockHand(id)], lastSeen + 1800);
        expect(result.controller?.id).toBe(id);
        expect(result.events.filter(e => e.type === "activate")).toHaveLength(1);
        expect(lock.update([mockHand(id)], lastSeen + 1801).events.some(e => e.type === "activate")).toBe(false);
        lastSeen += 1801;
      }
    });

    it("retains control during brief loss and excludes other hands", () => {
      activate();
      expect(lock.update([mockHand(2)], 2000).controller).toBeNull();
      expect(lock.publicState).toEqual({ kind: "locked", handId: 1 });
      expect(lock.update([mockHand(1), mockHand(2)], 2500).controller?.id).toBe(1);
    });

    it("expires exactly at 30 seconds, including during fast arming", () => {
      activate();
      lock.update([], 3001);
      lock.update([mockHand(2)], 31400);
      const expired = lock.update([mockHand(2)], 31500);
      expect(expired.controller).toBeNull();
      expect(lock.publicState).toMatchObject({ kind: "arming", progress: 0 });
      expect(lock.update([mockHand(2)], 31600).controller).toBeNull();
      expect(lock.update([mockHand(2)], 32999).controller).toBeNull();
      expect(lock.update([mockHand(2)], 33000).controller?.id).toBe(2);
    });

    it("bystanders and unsuccessful arming do not extend the session", () => {
      activate();
      lock.update([mockHand(2, "Pointing_Up")], 3001);
      lock.update([mockHand(2)], 10000);
      lock.update([], 10300);
      lock.update([mockHand(2, "Pointing_Up")], 31000);
      lock.update([mockHand(2)], 31500);
      expect(lock.update([mockHand(2)], 31700).controller).toBeNull();
      expect(lock.update([mockHand(2)], 33000).controller?.id).toBe(2);
    });

    it("refreshes the session only while the controlling hand is seen", () => {
      activate();
      lock.update([mockHand(1, "Pointing_Up")], 31000);
      lock.update([], 32501);
      lock.update([mockHand(2)], 60000);
      expect(lock.update([mockHand(2)], 60200).controller?.id).toBe(2);
    });

    it.each(["locked", "idle", "arming"])("manual release clears the session from %s", (state) => {
      activate();
      if (state !== "locked") lock.update([], 3001);
      if (state === "arming") lock.update([mockHand(2)], 3100);
      lock.release();
      lock.update([mockHand(3)], 4000);
      expect(lock.update([mockHand(3)], 4200).controller).toBeNull();
      expect(lock.update([mockHand(3)], 5500).controller?.id).toBe(3);
    });

    it.each([
      mockHand(2, "Pointing_Up"), mockHand(2, "Open_Palm", 0.1),
      mockHand(2, "Open_Palm", 0.9, 0.9, 0.9),
    ])("does not complete warm arming with an ineligible hand: %j", (invalid) => {
      lock = new ControllerLock({ ...DEFAULT_CONTROLLER, activationZone: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 } });
      activate();
      lock.update([], 3001);
      expect(lock.update([invalid], 3100).controller).toBeNull();
      expect(lock.publicState.kind).toBe("idle");
      lock.update([mockHand(2)], 3200);
      expect(lock.update([invalid], 3400).controller).toBeNull();
      lock.update([invalid], 3501);
      expect(lock.publicState.kind).toBe("idle");
    });

    it("cannot activate a missing hand within the arming grace period", () => {
      lock.acquireLock({ requiredHoldMs: 100 });
      lock.update([mockHand(1)], 0);
      expect(lock.update([], 100).events.some(e => e.type === "activate")).toBe(false);
    });

    it("override alone does not open a session and clearing it restores automatic timing", () => {
      lock.acquireLock({ requiredHoldMs: 0 });
      lock.update([], 0);
      lock.acquireLock();
      lock.update([mockHand(1)], 100);
      expect(lock.update([mockHand(1)], 300).controller).toBeNull();
      expect(lock.update([mockHand(1)], 1600).controller?.id).toBe(1);
      lock.update([], 3101);
      lock.acquireLock({ requiredHoldMs: 500 });
      lock.update([mockHand(2)], 3200);
      expect(lock.update([mockHand(2)], 3400).controller).toBeNull();
      expect(lock.update([mockHand(2)], 3700).controller?.id).toBe(2);
    });

    it("keeps an active countdown after the controller lowers their hand", () => {
      activate();
      lock.update([mockHand(1, "Victory")], 1600);
      expect(lock.update([mockHand(1, "Victory")], 2200).events.some(e => e.type === "countdownStart")).toBe(true);
      lock.update([], 3701);
      expect(lock.update([], 7200).events.some(e => e.type === "capture")).toBe(true);
    });

    it("engine stop resets automatic acquisition to cold", () => {
      const engine = new CvEngine({} as HTMLVideoElement);
      const controller = (engine as unknown as { controller: ControllerLock }).controller;
      controller.update([mockHand(1)], 0);
      controller.update([mockHand(1)], 1500);
      engine.stop();
      controller.update([mockHand(2)], 2000);
      expect(controller.update([mockHand(2)], 2200).controller).toBeNull();
      expect(controller.update([mockHand(2)], 3500).controller?.id).toBe(2);
    });
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
