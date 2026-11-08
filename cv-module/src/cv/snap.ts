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

export const STICKER_ANCHORS: Record<string, StickerAnchor> = {
  glasses: { landmark: FACE.NOSE_BRIDGE, offset: { x: 0, y: 0.05 }, widthScale: 1.6 },
  bunnyEars: { landmark: FACE.FOREHEAD, offset: { x: 0, y: -1.1 }, widthScale: 1.8 },
  hat: { landmark: FACE.FOREHEAD, offset: { x: 0, y: -0.8 }, widthScale: 2.0 },
  lips: { landmark: FACE.UPPER_LIP, offset: { x: 0, y: 0.1 }, widthScale: 0.8 },
  mustache: { landmark: FACE.UPPER_LIP, offset: { x: 0, y: -0.15 }, widthScale: 1.1 },
  nose: { landmark: FACE.NOSE_TIP, offset: { x: 0, y: 0 }, widthScale: 0.6 },
};

/** Sticker pose in frame pixels. `angle` is in radians (head roll). */
export interface Placement {
  x: number;
  y: number;
  width: number;
  angle: number;
}

export function placeSticker(face: TrackedFace, kind: string, size: FrameSize): Placement {
  const anchor = STICKER_ANCHORS[kind] ?? {
    landmark: FACE.NOSE_BRIDGE,
    offset: { x: 0, y: 0 },
    widthScale: 1.2,
  };
  const eyeA = toPx(face.landmarks[FACE.RIGHT_EYE_OUTER], size);
  const eyeB = toPx(face.landmarks[FACE.LEFT_EYE_OUTER], size);
  // Vector from the eye on the screen's left to the eye on the screen's right.
  const [left, right] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];

  const eyeDist = Math.max(dist(left, right), 1);
  const angle = Math.atan2(right.y - left.y, right.x - left.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const base = toPx(face.landmarks[anchor.landmark] ?? face.landmarks[FACE.NOSE_BRIDGE], size);
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
 * Smart Snap-to-Face algorithm:
 * Automatically finds the most appropriate active face from face tracking data.
 *
 * Rules:
 * 1. Excludes stale or untracked faces.
 * 2. If exactly one active face exists, automatically selects that face.
 * 3. If multiple active faces exist, chooses the face closest to the target point.
 *    If target point is not provided, chooses the closest face to camera (largest eye distance).
 * 4. Returns null if no reliable active face is detected.
 */
export function findSmartSnapTarget(
  faces: TrackedFace[],
  kind: string,
  size: FrameSize,
  targetPoint?: Point | null,
): SnapTarget | null {
  const activeFaces = faces.filter((f) => !f.stale && f.landmarks && f.landmarks.length > 0);
  if (activeFaces.length === 0) return null;

  if (activeFaces.length === 1) {
    const face = activeFaces[0];
    const placement = placeSticker(face, kind, size);
    return { face, placement, distance: 0 };
  }

  let best: SnapTarget | null = null;
  for (const face of activeFaces) {
    const placement = placeSticker(face, kind, size);
    let distance = 0;

    if (targetPoint && Number.isFinite(targetPoint.x) && Number.isFinite(targetPoint.y)) {
      distance = dist(targetPoint, { x: placement.x, y: placement.y });
    } else {
      // Pick the primary face (closest to camera / largest face)
      const eyeA = toPx(face.landmarks[FACE.RIGHT_EYE_OUTER], size);
      const eyeB = toPx(face.landmarks[FACE.LEFT_EYE_OUTER], size);
      const eyeDist = dist(eyeA, eyeB);
      distance = -eyeDist;
    }

    if (!best || distance < best.distance) {
      best = { face, placement, distance };
    }
  }

  return best;
}

/**
 * Returns the face whose anchor for `kind` is closest to the drop point.
 * Retained for backward-compatibility.
 */
export function findSnapTarget(
  drop: Point,
  faces: TrackedFace[],
  kind: string,
  size: FrameSize,
  radiusScale = 1.5,
): SnapTarget | null {
  let best: SnapTarget | null = null;
  for (const face of faces) {
    const placement = placeSticker(face, kind, size);
    const anchorScale = STICKER_ANCHORS[kind]?.widthScale ?? 1.2;
    const eyeDist = placement.width / anchorScale;
    const distance = dist(drop, placement);
    if (distance > radiusScale * eyeDist) continue;
    if (!best || distance < best.distance) best = { face, placement, distance };
  }
  return best;
}
