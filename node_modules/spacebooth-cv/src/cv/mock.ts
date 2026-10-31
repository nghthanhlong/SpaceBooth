import { Emitter } from "./emitter";
import type { CvSource } from "./engine";
import type { CvEventMap, Point } from "./types";

/**
 * Emits the same events as CvEngine from mouse + keyboard, so the UI team can
 * build screens without a webcam or a working CV pipeline.
 *
 *   mouse move = cursor   mouse down/up = pinch   A = activate   R = release   V = countdown, then capture
 */
export class MockCv extends Emitter<CvEventMap> implements CvSource {
  private cursor: Point = { x: 0.5, y: 0.5 };
  private abort: AbortController | null = null;
  private timers: number[] = [];

  constructor(
    private stage: HTMLElement,
    private countdownMs = 5000,
  ) {
    super();
  }

  async start(): Promise<void> {
    this.abort = new AbortController();
    const { signal } = this.abort;

    this.stage.addEventListener(
      "pointermove",
      (e) => {
        const r = this.stage.getBoundingClientRect();
        this.cursor = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
        this.emit("cursor", this.cursor);
      },
      { signal },
    );
    this.stage.addEventListener("pointerdown", () => this.emit("pinchStart", this.cursor), { signal });
    this.stage.addEventListener("pointerup", () => this.emit("pinchEnd", this.cursor), { signal });
    window.addEventListener(
      "keydown",
      (e) => {
        const key = e.key.toLowerCase();
        if (key === "a") this.emit("activate", { handId: 0 });
        if (key === "r") this.emit("release", { handId: 0, reason: "manual" });
        if (key === "v" && this.timers.length === 0) this.startCountdown();
      },
      { signal },
    );
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private startCountdown() {
    const seconds = Math.ceil(this.countdownMs / 1000);
    this.emit("countdownStart", { durationMs: this.countdownMs, victoryHands: 1 });
    for (let s = seconds; s >= 1; s--) {
      this.timers.push(window.setTimeout(() => this.emit("countdown", { secondsLeft: s }), (seconds - s) * 1000));
    }
    this.timers.push(
      window.setTimeout(() => {
        this.timers = [];
        this.emit("capture", { victoryHands: 1 });
      }, this.countdownMs),
    );
  }
}
