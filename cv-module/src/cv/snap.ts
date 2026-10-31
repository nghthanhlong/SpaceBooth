import { dist, toPx } from "./geometry";
import { FACE } from "./landmarks";
import type { FrameSize, Point, TrackedFace } from "./types";

export type StickerKind = "glasses" | "bunnyEars" | "hat" | "lips";

/**
 * Where a sticker sits on a face.
 * `offset` and `widthScale` are in units of the eye distance and in the face's
 * own frame (x to the right of the face, y down the face), so the sticker
 * scales with distance and rotates when the head tilts.
 */
export interface StickerAnchor {
  landmark: number;
  offset: Point;
  widthScale: number;
}

export const STICKER_ANCHORS: Record<StickerKind, StickerAnchor> = {
  glasses: { landmark: FACE.NOSE_BRIDGE, offset: { x: 0, y: 0.05 }, widthScale: 1.6 },
  bunnyEars: { landmark: FACE.FOREHEAD, offset: { x: 0, y: -1.1 }, widthScale: 1.8 },
  hat: { landmark: FACE.FOREHEAD, offset: { x: 0, y: -0.8 }, widthScale: 2.0 },
  lips: { landmark: FACE.UPPER_LIP, offset: { x: 0, y: 0.1 }, widthScale: 0.8 },
};

/** Sticker pose in frame pixels. `angle` is in radians (head roll). */
export interface Placement {
  x: number;
  y: number;
  width: number;
  angle: number;
}

export function placeSticker(face: TrackedFace, kind: StickerKind, size: FrameSize): Placement {
  const anchor = STICKER_ANCHORS[kind];
  const eyeA = toPx(face.landmarks[FACE.RIGHT_EYE_OUTER], size);
  const eyeB = toPx(face.landmarks[FACE.LEFT_EYE_OUTER], size);
  // Vector from the eye on the screen's left to the eye on the screen's right.
  const [left, right] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];

  const eyeDist = dist(left, right);
  const angle = Math.atan2(right.y - left.y, right.x - left.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const base = toPx(face.landmarks[anchor.landmark], size);
  const ox = anchor.offset.x * eyeDist;
  const oy = anchor.offset.y * eyeDist;

  return {
    x: base.x + ox * cos - oy * sin,
    y: base.y + ox * sin + oy * cos,
    width: anchor.widthScale * eyeDist,
    angle,
  };
}

export interface SnapTarget {
  face: TrackedFace;
  placement: Placement;
  distance: number;
}

/**
 * Smart Snap-to-Face: returns the face whose anchor for `kind` is closest to
 * the drop point, if it is within `radiusScale` eye distances. The tolerance
 * grows with face size, so dropping roughly near a face is enough.
 *
 * @param drop Drop point in frame pixels.
 */
export function findSnapTarget(
  drop: Point,
  faces: TrackedFace[],
  kind: StickerKind,
  size: FrameSize,
  radiusScale = 1.5,
): SnapTarget | null {
  let best: SnapTarget | null = null;
  for (const face of faces) {
    const placement = placeSticker(face, kind, size);
    const eyeDist = placement.width / STICKER_ANCHORS[kind].widthScale;
    const distance = dist(drop, placement);
    if (distance > radiusScale * eyeDist) continue;
    if (!best || distance < best.distance) best = { face, placement, distance };
  }
  return best;
}
