import { FACE, HAND } from "./landmarks";
import type { ControllerState, ControllerTarget, FrameSize, TrackedFace, TrackedHand } from "./types";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export const DEFAULT_OWNERSHIP = {
  minConfidence: 0.6,
  wristRadius: 0.35,
  faceRadius: 1,
  ambiguityRatio: 0.7,
  observations: 3,
  stableMs: 200,
  maxAgeMs: 350,
};
export type OwnershipConfig = typeof DEFAULT_OWNERSHIP;
type Pair = { handId: number; faceId: number; count: number; since: number; seen: number };
type Edge = { source: number; target: number; cost: number };

// Reject competing assignments before accepting any, so iteration order cannot
// turn an ambiguous match into a confident one.
function unambiguous(edges: Edge[], ratio: number): Edge[] {
  return edges.filter(e => !edges.some(other => other !== e &&
    (other.source === e.source || other.target === e.target) &&
    (e.cost === 0 ? other.cost === 0 : other.cost < e.cost / ratio)));
}

/** Conservative geometric association, not biometric identification. */
export class OwnershipResolver {
  private pairs = new Map<number, Pair>();
  private lockedFace: number | null = null;
  private lockedHand: number | null = null;
  private observedAt: number | null = null;

  constructor(private cfg: OwnershipConfig = DEFAULT_OWNERSHIP) {}

  reset() {
    this.pairs.clear();
    this.lockedFace = this.lockedHand = this.observedAt = null;
  }

  beginAcquisition() {
    this.lockedFace = this.lockedHand = null;
  }

  observe(hands: TrackedHand[], faces: TrackedFace[], poses: NormalizedLandmark[][],
    size: FrameSize, now: number) {
    if (this.observedAt === now) return;
    this.observedAt = now;
    const distance = (a: NormalizedLandmark, b: NormalizedLandmark) =>
      Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height);
    const visible = (p: NormalizedLandmark | undefined) => p &&
      Number.isFinite(p.x) && Number.isFinite(p.y) && p.visibility >= this.cfg.minConfidence;
    const wrists: Edge[] = [];
    const heads: Edge[] = [];
    poses.forEach((pose, index) => {
      if (!visible(pose[11]) || !visible(pose[12])) return;
      const shoulderWidth = distance(pose[11], pose[12]);
      if (shoulderWidth < 1) return;
      for (const [side, wrist] of [15, 16].entries()) {
        if (!visible(pose[wrist])) continue;
        for (const hand of hands) {
          const cost = distance(hand.landmarks[HAND.WRIST], pose[wrist]) / shoulderWidth;
          if (cost <= this.cfg.wristRadius) wrists.push({ source: hand.id, target: index * 2 + side, cost });
        }
      }
      if (![0, 2, 5].every(i => visible(pose[i]))) return;
      for (const face of faces) {
        if (face.stale) continue;
        const eyeWidth = distance(face.landmarks[FACE.RIGHT_EYE_OUTER], face.landmarks[FACE.LEFT_EYE_OUTER]);
        if (eyeWidth < 1) continue;
        const noseCost = distance(pose[0], face.landmarks[FACE.NOSE_TIP]) / eyeWidth;
        const midpoint = (a: NormalizedLandmark, b: NormalizedLandmark): NormalizedLandmark =>
          ({ ...a, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const eyeCost = distance(midpoint(pose[2], pose[5]),
          midpoint(face.landmarks[FACE.RIGHT_EYE_OUTER], face.landmarks[FACE.LEFT_EYE_OUTER])) / eyeWidth;
        if (noseCost <= this.cfg.faceRadius && eyeCost <= this.cfg.faceRadius) {
          heads.push({ source: index, target: face.id, cost: (noseCost + eyeCost) / 2 });
        }
      }
    });
    const faceByPose = new Map(unambiguous(heads, this.cfg.ambiguityRatio).map(e => [e.source, e.target]));
    const next = new Map<number, Pair>();
    for (const edge of unambiguous(wrists, this.cfg.ambiguityRatio)) {
      const faceId = faceByPose.get(Math.floor(edge.target / 2));
      if (faceId === undefined) continue;
      const previous = this.pairs.get(edge.source);
      const continuous = previous?.faceId === faceId && now - previous.seen <= this.cfg.maxAgeMs;
      next.set(edge.source, { handId: edge.source, faceId, seen: now,
        count: continuous ? previous.count + 1 : 1, since: continuous ? previous.since : now });
    }
    this.pairs = next;
  }

  target(controller: ControllerState, hands: TrackedHand[], faces: TrackedFace[],
    now: number, available: boolean): ControllerTarget {
    if (!available) return { status: "unavailable", handId: null, faceId: null, observedAt: null };
    if (controller.kind !== "locked") {
      this.beginAcquisition();
      return { status: "pending", handId: null, faceId: null, observedAt: null };
    }
    const handId = controller.handId;
    if (this.lockedHand !== handId) { this.lockedHand = handId; this.lockedFace = null; }
    const pair = this.pairs.get(handId);
    const fresh = pair && now - pair.seen <= this.cfg.maxAgeMs &&
      hands.some(h => h.id === handId) && faces.some(f => f.id === pair.faceId && !f.stale);
    const confirmed = fresh && pair.count >= this.cfg.observations && now - pair.since >= this.cfg.stableMs;
    if (confirmed && this.lockedFace === null) this.lockedFace = pair.faceId;
    const conflict = fresh && this.lockedFace !== null && pair.faceId !== this.lockedFace;
    return { status: conflict ? "ambiguous" : confirmed ? "confirmed" : "pending", handId,
      faceId: confirmed && !conflict ? pair.faceId : null, observedAt: pair?.seen ?? null };
  }
}
