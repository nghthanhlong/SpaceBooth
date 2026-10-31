import type { FrameSize, Point } from "./types";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance in pixels between two normalized points (accounts for the frame aspect ratio). */
export const distPx = (a: Point, b: Point, size: FrameSize) =>
  Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height);

export const toPx = (p: Point, size: FrameSize): Point => ({
  x: p.x * size.width,
  y: p.y * size.height,
});

export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** A sub-region of the camera frame, in normalized coordinates. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Maps a point inside `box` to [0,1]², clamping points outside the box to the edge. */
export const mapFromBox = (p: Point, box: Box): Point => ({
  x: clamp((p.x - box.x0) / (box.x1 - box.x0), 0, 1),
  y: clamp((p.y - box.y0) / (box.y1 - box.y0), 0, 1),
});

export const inBox = (p: Point, box: Box) =>
  p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
