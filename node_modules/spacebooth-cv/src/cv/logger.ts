import type { CvSource } from "./engine";
import type { CvEventMap, FrameStats } from "./types";

interface LogEntry {
  /** Milliseconds since the logger started. */
  t: number;
  type: string;
  data?: unknown;
}

const DISCRETE_EVENTS: (keyof CvEventMap)[] = ["activate", "release", "pinchStart", "pinchEnd", "countdownStart", "capture"];

/**
 * Records events for the evaluation: false activations, missed grabs, task time, latency.
 * Use `mark()` for ground truth, e.g. the tester presses a key whenever the user
 * INTENDS to pinch, then compare marks with detected pinchStart events.
 */
export class EventLogger {
  private entries: LogEntry[] = [];
  private frames: FrameStats[] = [];
  private t0 = performance.now();

  attach(source: CvSource): () => void {
    const unsubscribers = DISCRETE_EVENTS.map((type) =>
      source.on(type, (payload) => this.add(type, payload)),
    );
    unsubscribers.push(source.on("frame", (f) => this.frames.push(f.stats)));
    return () => unsubscribers.forEach((off) => off());
  }

  mark(type: string, data?: unknown): void {
    this.add(`mark:${type}`, data);
  }

  reset(): void {
    this.entries = [];
    this.frames = [];
    this.t0 = performance.now();
  }

  counts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this.entries) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return counts;
  }

  summary() {
    const totals = this.frames.map((f) => f.totalMs);
    const fps = this.frames.map((f) => f.fps).filter((v) => v > 0);
    return {
      durationMs: performance.now() - this.t0,
      frames: this.frames.length,
      processingMs: { p50: percentile(totals, 50), p95: percentile(totals, 95) },
      // Low-percentile FPS shows stutter better than the average.
      fps: { mean: mean(fps), p5: percentile(fps, 5) },
      counts: this.counts(),
    };
  }

  download(filename = `spacebooth-log-${Date.now()}.json`): void {
    const json = JSON.stringify({ summary: this.summary(), events: this.entries }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Records any app-level event, e.g. a sticker drop and whether it snapped. */
  record(type: string, data?: unknown): void {
    this.add(type, data);
  }

  private add(type: string, data?: unknown) {
    this.entries.push({ t: Math.round(performance.now() - this.t0), type, data });
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}
