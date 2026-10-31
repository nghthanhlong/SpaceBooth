import type { Point } from "./types";

/**
 * One-Euro filter (Casiez et al., CHI 2012).
 * Slow movement -> low cutoff -> strong smoothing (removes hand tremor).
 * Fast movement -> high cutoff -> little lag.
 *
 * Tuning: lower `minCutoff` to remove more jitter, raise `beta` to reduce lag.
 * Values here assume normalized [0,1] coordinates (speeds around 1 unit/s).
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT: number | null = null;

  constructor(
    public minCutoff = 1.0,
    public beta = 5.0,
    public dCutoff = 1.0,
  ) {}

  filter(value: number, tMs: number): number {
    if (this.x === null || this.lastT === null) {
      this.x = value;
      this.lastT = tMs;
      return value;
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1e-3);
    this.lastT = tMs;

    const rawDx = (value - this.x) / dt;
    this.dx = lerp(this.dx, rawDx, smoothingFactor(dt, this.dCutoff));

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = lerp(this.x, value, smoothingFactor(dt, cutoff));
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.lastT = null;
  }
}

export class OneEuroFilter2D {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(minCutoff?: number, beta?: number) {
    this.fx = new OneEuroFilter(minCutoff, beta);
    this.fy = new OneEuroFilter(minCutoff, beta);
  }

  filter(p: Point, tMs: number): Point {
    return { x: this.fx.filter(p.x, tMs), y: this.fy.filter(p.y, tMs) };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}

function smoothingFactor(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function lerp(prev: number, next: number, alpha: number): number {
  return prev + alpha * (next - prev);
}
