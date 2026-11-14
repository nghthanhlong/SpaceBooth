import { inBox, type Box } from "./geometry";
import { HAND } from "./landmarks";
import type { ControllerState, CvEvent, GestureName, TrackedHand } from "./types";

export interface ControllerConfig {
  /** How long the open palm must be held to take control. */
  dwellMs: number;
  /** Minimum gesture confidence to count a gesture. */
  gestureMinScore: number;
  /** The controller loses control after its hand is missing for this long. */
  lostTimeoutMs: number;
  /** Short drops of the open palm during dwell are tolerated for this long. */
  armingGraceMs: number;
  /** How long the Victory gesture must be held to start the capture countdown. */
  captureHoldMs: number;
  /** Countdown between the Victory gesture and the photo, so everyone can pose. */
  countdownMs: number;
  /** The countdown also starts when at least this many hands show Victory (even if the controller does not). */
  captureMinHands: number;
  /** No new capture during this period after a capture. */
  captureCooldownMs: number;
  /** Only an open palm whose wrist is inside this box can take control. null = whole frame. */
  activationZone: Box | null;
}

export interface AcquireControllerOptions {
  /** How long the open palm must be held to take control. Default: cfg.dwellMs (1500ms). */
  requiredHoldMs?: number;
}

export const DEFAULT_CONTROLLER: ControllerConfig = {
  dwellMs: 1500,
  gestureMinScore: 0.6,
  lostTimeoutMs: 1500,
  armingGraceMs: 250,
  captureHoldMs: 600,
  countdownMs: 5000,
  captureMinHands: 2,
  captureCooldownMs: 3000,
  activationZone: null,
};

type InternalState =
  | { kind: "idle" }
  | { kind: "arming"; handId: number; start: number; lastOk: number; progress: number }
  | { kind: "locked"; handId: number; lastSeen: number };

/**
 * Controller lock: decides WHO controls the cursor when many people/hands are in view.
 *
 *   idle --(open palm held dwellMs)--> locked --(hand missing > lostTimeoutMs)--> idle
 *
 * While locked, only the controller's hand moves the cursor and pinches.
 * Capture is the exception: the countdown starts when the controller shows Victory,
 * or when `captureMinHands` hands show Victory at the same time.
 * Once started, the countdown always runs to the photo, even if hands drop or
 * control is lost, because people lower their hands to pose.
 */
export class ControllerLock {
  private state: InternalState = { kind: "idle" };
  private captureStart: number | null = null;
  private cooldownUntil = 0;
  private countdown: { end: number; secondsLeft: number; victoryHands: number } | null = null;
  private acquireOptions: AcquireControllerOptions = {};

  constructor(private cfg: ControllerConfig = DEFAULT_CONTROLLER) {}

  /**
   * Configures lock acquisition options (e.g. for warm re-entry).
   * Passing { requiredHoldMs: 0 } or a low value like 100ms allows fast re-acquisition.
   */
  acquireLock(options: AcquireControllerOptions = {}): void {
    this.acquireOptions = { ...options };
  }

  getAcquireOptions(): AcquireControllerOptions {
    return { ...this.acquireOptions };
  }

  update(
    hands: TrackedHand[],
    now: number,
    options?: AcquireControllerOptions,
  ): { controller: TrackedHand | null; events: CvEvent[] } {
    const events: CvEvent[] = [];
    const byId = (id: number) => hands.find((h) => h.id === id) ?? null;
    const effectiveHoldMs =
      options?.requiredHoldMs ?? this.acquireOptions.requiredHoldMs ?? this.cfg.dwellMs;

    switch (this.state.kind) {
      case "idle": {
        const candidate = hands.find((h) => this.is(h, "Open_Palm") && this.inZone(h));
        if (candidate) {
          if (effectiveHoldMs <= 0) {
            events.push({ type: "activate", payload: { handId: candidate.id } });
            this.state = { kind: "locked", handId: candidate.id, lastSeen: now };
          } else {
            this.state = { kind: "arming", handId: candidate.id, start: now, lastOk: now, progress: 0 };
          }
        }
        break;
      }
      case "arming": {
        const hand = byId(this.state.handId);
        if (hand && this.is(hand, "Open_Palm")) this.state.lastOk = now;

        if (now - this.state.lastOk > this.cfg.armingGraceMs) {
          events.push({ type: "dwellProgress", payload: { handId: this.state.handId, progress: 0 } });
          this.state = { kind: "idle" };
          break;
        }
        const progress = effectiveHoldMs <= 0 ? 1 : Math.min((now - this.state.start) / effectiveHoldMs, 1);
        this.state.progress = progress;
        events.push({ type: "dwellProgress", payload: { handId: this.state.handId, progress } });
        if (progress >= 1) {
          events.push({ type: "activate", payload: { handId: this.state.handId } });
          this.state = { kind: "locked", handId: this.state.handId, lastSeen: now };
        }
        break;
      }
      case "locked": {
        if (byId(this.state.handId)) {
          this.state.lastSeen = now;
        } else if (now - this.state.lastSeen > this.cfg.lostTimeoutMs) {
          events.push({ type: "release", payload: { handId: this.state.handId, reason: "lost" } });
          this.state = { kind: "idle" };
          this.cancelCapture(events);
        }
        break;
      }
    }

    const controller = this.state.kind === "locked" ? byId(this.state.handId) : null;
    if (this.countdown) this.updateCountdown(now, events);
    else if (this.state.kind === "locked") this.updateCapture(hands, controller, now, events);

    return { controller, events };
  }

  /** Gives up control on purpose, e.g. when a photo session ends. */
  release(): CvEvent[] {
    if (this.state.kind !== "locked") {
      this.state = { kind: "idle" };
      return [];
    }
    const events: CvEvent[] = [
      { type: "release", payload: { handId: this.state.handId, reason: "manual" } },
    ];
    this.state = { kind: "idle" };
    this.cancelCapture(events);
    return events;
  }

  get publicState(): ControllerState {
    const s = this.state;
    if (s.kind === "idle") return s;
    if (s.kind === "locked") return { kind: "locked", handId: s.handId };
    return { kind: "arming", handId: s.handId, progress: s.progress };
  }

  private updateCapture(hands: TrackedHand[], controller: TrackedHand | null, now: number, events: CvEvent[]) {
    if (now < this.cooldownUntil) return;

    const victoryHands = hands.filter((h) => this.is(h, "Victory")).length;
    const ready = (controller !== null && this.is(controller, "Victory")) || victoryHands >= this.cfg.captureMinHands;

    if (!ready) {
      this.cancelCapture(events, victoryHands);
      return;
    }

    this.captureStart ??= now;
    const progress = Math.min((now - this.captureStart) / this.cfg.captureHoldMs, 1);
    events.push({ type: "captureProgress", payload: { progress, victoryHands } });

    if (progress >= 1) {
      this.captureStart = null;
      const secondsLeft = Math.ceil(this.cfg.countdownMs / 1000);
      this.countdown = { end: now + this.cfg.countdownMs, secondsLeft, victoryHands };
      events.push({ type: "countdownStart", payload: { durationMs: this.cfg.countdownMs, victoryHands } });
      events.push({ type: "countdown", payload: { secondsLeft } });
    }
  }

  private updateCountdown(now: number, events: CvEvent[]) {
    const cd = this.countdown!;
    const secondsLeft = Math.max(Math.ceil((cd.end - now) / 1000), 0);
    if (secondsLeft < cd.secondsLeft) {
      cd.secondsLeft = secondsLeft;
      if (secondsLeft > 0) events.push({ type: "countdown", payload: { secondsLeft } });
    }
    if (now >= cd.end) {
      events.push({ type: "capture", payload: { victoryHands: cd.victoryHands } });
      this.countdown = null;
      this.cooldownUntil = now + this.cfg.captureCooldownMs;
    }
  }

  private cancelCapture(events: CvEvent[], victoryHands = 0) {
    if (this.captureStart === null) return;
    this.captureStart = null;
    events.push({ type: "captureProgress", payload: { progress: 0, victoryHands } });
  }

  private is(hand: TrackedHand, gesture: GestureName): boolean {
    return hand.gesture === gesture && hand.gestureScore >= this.cfg.gestureMinScore;
  }

  private inZone(hand: TrackedHand): boolean {
    return this.cfg.activationZone === null || inBox(hand.landmarks[HAND.WRIST], this.cfg.activationZone);
  }
}
