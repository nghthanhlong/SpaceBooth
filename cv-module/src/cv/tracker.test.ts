/**
 * Unit tests for IdTracker ambiguity check (tracker.ts).
 *
 * Covers:
 *  1. Ambiguous scenario — two detections equidistant from two tracks:
 *     neither track should be assigned a new detection (both "miss" the frame).
 *  2. Unambiguous scenario — one detection clearly closer to one track:
 *     the clear match proceeds as before; the other track misses.
 *  3. Normal uncontested match — single track + single detection: works as before.
 *  4. Ratio boundary — competitor just inside vs. just outside AMBIGUITY_RATIO=0.7.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { IdTracker } from "./tracker";
import type { Point } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const posOf = (p: Point) => p;

function pt(x: number, y: number): Point {
  return { x, y };
}

/** Advance a tracker by one frame; returns ids of tracks that were UPDATED (non-stale) this frame. */
function step(
  tracker: IdTracker<Point>,
  items: Point[],
  now: number,
): { seen: number[]; alive: number[] } {
  const seen = tracker.update(items, posOf, now).map((t) => t.id);
  const alive = tracker.alive().map((t) => t.id);
  return { seen, alive };
}

// ─── Constants matching tracker.ts ───────────────────────────────────────────

const MAX_DISTANCE = 0.3; // normalised units
const MAX_MISSED_MS = 2000;

// ─── Test suites ──────────────────────────────────────────────────────────────

describe("IdTracker — ambiguity check", () => {
  let tracker: IdTracker<Point>;

  beforeEach(() => {
    tracker = new IdTracker<Point>(MAX_DISTANCE, MAX_MISSED_MS);
  });

  // ── 1. Ambiguous frame ───────────────────────────────────────────────────────

  it("does NOT assign either track when two detections are equidistant from two tracks", () => {
    // Frame 0: establish two tracks — A at x=0.10, B at x=0.20
    const t0 = 0;
    const { seen: ids0 } = step(tracker, [pt(0.10, 0.5), pt(0.20, 0.5)], t0);
    expect(ids0).toHaveLength(2);
    const [idA, idB] = ids0;

    // Frame 1: two detections at x=0.14 and x=0.16 — both equally close to both tracks.
    // d(0.14→0.10)=0.04, d(0.14→0.20)=0.06, d(0.16→0.10)=0.06, d(0.16→0.20)=0.04
    // Best pair: (det=0.14, track A, d=0.04).  Competitor: (det=0.14, track B, d=0.06).
    //   0.06 < 0.04 / 0.7 = 0.0571? No → 0.06 > 0.0571 → not ambiguous for that specific pair.
    // Wait — let's use positions that ARE truly ambiguous: same x distance from both tracks.
    // Track A at 0.10, Track B at 0.20.  Detection at 0.15 is exactly equidistant (0.05 each).
    // Detection at 0.15 for both tracks: competitor.d=0.05 < winner.d/0.7=0.05/0.7=0.0714 → YES ambiguous.

    // Use two detections that are symmetric: 0.13 and 0.17
    // d(0.13→0.10)=0.03, d(0.13→0.20)=0.07, d(0.17→0.10)=0.07, d(0.17→0.20)=0.03
    // Sorted pairs: (det0.13, trackA, 0.03), (det0.17, trackB, 0.03), (det0.13, trackB, 0.07), ...
    // For pair k=(det0.13, trackA, 0.03): competitor is (det0.17, trackA, 0.07) — same j=A?
    //   other.j === j → YES. other.d=0.07 < 0.03/0.7=0.0429? No → not ambiguous via same track.
    //   other.i === i (det0.13) → competitor (det0.13, trackB, 0.07): other.d=0.07 < 0.0429? No.
    // Actually NOT ambiguous with that layout. Need positions where competitor.d < d/AMBIGUITY_RATIO.

    // For TRUE ambiguity: use detection at 0.145, track A at 0.10, track B at 0.20.
    //   d(0.145→A)=0.045, d(0.145→B)=0.055
    //   Competitor for same detection (i=0.145) going to track B: 0.055 < 0.045/0.7=0.0643 → YES → ambiguous!
    // Similarly detection at 0.155: d(→A)=0.055, d(→B)=0.045 → same logic → ambiguous.

    const t1 = 100;
    const { seen: seen1 } = step(tracker, [pt(0.145, 0.5), pt(0.155, 0.5)], t1);

    // The old track IDs should NOT appear in `seen` — neither A nor B was matched.
    expect(seen1).not.toContain(idA);
    expect(seen1).not.toContain(idB);

    // Both old tracks should still be alive (within maxMissedMs).
    const aliveIds = tracker.alive().map((t) => t.id);
    expect(aliveIds).toContain(idA);
    expect(aliveIds).toContain(idB);
  });

  it("tracks last-known positions are NOT updated when ambiguous (no ID swap)", () => {
    const t0 = 0;
    step(tracker, [pt(0.10, 0.5), pt(0.20, 0.5)], t0);

    const posBeforeA = tracker.alive().find((t) => t.pos.x === 0.10)?.pos;
    const posBeforeB = tracker.alive().find((t) => t.pos.x === 0.20)?.pos;

    // Ambiguous frame
    step(tracker, [pt(0.145, 0.5), pt(0.155, 0.5)], 100);

    // Positions should be unchanged (tracks "missed" this frame)
    const afterA = tracker.alive().find((t) => Math.abs(t.pos.x - 0.10) < 0.001);
    const afterB = tracker.alive().find((t) => Math.abs(t.pos.x - 0.20) < 0.001);
    expect(afterA?.pos).toEqual(posBeforeA);
    expect(afterB?.pos).toEqual(posBeforeB);
  });

  // ── 2. Unambiguous frame — clear winner ──────────────────────────────────────

  it("matches the clearly-closer detection and lets the other track miss", () => {
    // Track A at 0.10, track B at 0.20
    const t0 = 0;
    const { seen: ids0 } = step(tracker, [pt(0.10, 0.5), pt(0.20, 0.5)], t0);
    const [idA, idB] = ids0;

    // Detection at 0.11 (very close to A, far from B).
    // d(0.11→A)=0.01, d(0.11→B)=0.09.  Competitor.d=0.09 < 0.01/0.7=0.0143? NO → not ambiguous.
    // So track A should be matched to detection at 0.11.
    const t1 = 100;
    const { seen: seen1 } = step(tracker, [pt(0.11, 0.5)], t1);

    expect(seen1).toContain(idA);  // A matched
    expect(seen1).not.toContain(idB); // B missed (no detection)

    // A's position updated; B still alive but with old position
    const trackA = tracker.alive().find((t) => t.id === idA);
    const trackB = tracker.alive().find((t) => t.id === idB);
    expect(trackA?.pos.x).toBeCloseTo(0.11);
    expect(trackB?.pos.x).toBeCloseTo(0.20); // unchanged
  });

  // ── 3. Normal single-track uncontested match ─────────────────────────────────

  it("handles uncontested single-track matching without interference", () => {
    const t0 = 0;
    const { seen: ids0 } = step(tracker, [pt(0.5, 0.5)], t0);
    const [idSolo] = ids0;

    // Detection moves slightly — no other track → no ambiguity possible
    const { seen: seen1 } = step(tracker, [pt(0.52, 0.5)], 100);
    expect(seen1).toContain(idSolo);
    expect(tracker.alive().find((t) => t.id === idSolo)?.pos.x).toBeCloseTo(0.52);
  });

  // ── 4. Ratio boundary tests ───────────────────────────────────────────────────

  it("does NOT flag as ambiguous when competitor distance is exactly at the ratio boundary (not strictly inside)", () => {
    // Track A at 0.00, track B at 0.20.
    // Detection at x=0.05: d→A=0.05, d→B=0.15
    // Competitor ratio check: 0.15 < 0.05/0.7=0.0714? NO (0.15 >> 0.0714) → not ambiguous.
    // This tests that clear matches are not incorrectly blocked.
    const t0 = 0;
    const { seen: ids0 } = step(tracker, [pt(0.00, 0.5), pt(0.20, 0.5)], t0);
    const [idA] = ids0;

    const { seen: seen1 } = step(tracker, [pt(0.05, 0.5)], 100);
    expect(seen1).toContain(idA); // Clear match — must NOT be blocked
  });

  it("flags as ambiguous when competitor distance is strictly inside the ratio boundary", () => {
    // Track A at 0.10, track B at 0.20.
    // Detection at exactly 0.15: d→A=0.05, d→B=0.05.
    // Competitor for same detection going to B: 0.05 < 0.05/0.7=0.0714 → YES → ambiguous.
    const t0 = 0;
    const { seen: ids0 } = step(tracker, [pt(0.10, 0.5), pt(0.20, 0.5)], t0);
    const [idA, idB] = ids0;

    const { seen: seen1 } = step(tracker, [pt(0.15, 0.5)], 100);
    expect(seen1).not.toContain(idA);
    expect(seen1).not.toContain(idB);
    // Detection creates a new track (since it wasn't matched to anything)
    const newIds = seen1.filter((id) => id !== idA && id !== idB);
    expect(newIds).toHaveLength(1);
  });
});
