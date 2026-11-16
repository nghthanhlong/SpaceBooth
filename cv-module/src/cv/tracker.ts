import { dist } from "./geometry";
import type { Point } from "./types";

export interface Track<T> {
  id: number;
  item: T;
  pos: Point;
  lastSeen: number;
}

/**
 * When two competing matches share the same detection (i) or the same track (j)
 * and their distances are within this ratio of each other, neither match is
 * accepted. This prevents ID swaps when two faces stand close together.
 * Example: ratio 0.7 means a competing pair is "close enough" if
 * competitor.d < winner.d / 0.7  →  competitor.d / winner.d < ~1.43×.
 */
const AMBIGUITY_RATIO = 0.7;

/**
 * Gives detections a stable id across frames.
 * MediaPipe on the web does not return persistent ids, so we match each new
 * detection to the nearest existing track (greedy nearest-neighbor).
 * A track survives `maxMissedMs` without detections, so a hand that flickers
 * out for a few frames keeps its id (and keeps control).
 */
export class IdTracker<T> {
  private tracks: Track<T>[] = [];
  private nextId = 1;
  private velocities = new Map<number, Point>();

  constructor(private maxDistance: number, private maxMissedMs: number,
    private options: { predictionMs?: number; deferAmbiguous?: boolean } = {}) {}

  /** Returns the tracks matched or created in this frame. */
  update(items: T[], posOf: (item: T) => Point, now: number): Track<T>[] {
    // Expired tracks must not reclaim a new arrival before they are purged.
    this.tracks = this.tracks.filter(t => now - t.lastSeen <= this.maxMissedMs);
    const liveIds = new Set(this.tracks.map(t => t.id));
    for (const id of this.velocities.keys()) if (!liveIds.has(id)) this.velocities.delete(id);
    const positions = items.map(posOf);

    const pairs: { i: number; j: number; d: number }[] = [];
    positions.forEach((p, i) => {
      this.tracks.forEach((track, j) => {
        const velocity = this.velocities.get(track.id) ?? { x: 0, y: 0 };
        const horizon = Math.min(now - track.lastSeen, this.options.predictionMs ?? 0);
        const offset = { x: velocity.x * horizon, y: velocity.y * horizon };
        const length = Math.hypot(offset.x, offset.y);
        const clamp = length > this.maxDistance / 2 ? this.maxDistance / 2 / length : 1;
        const predicted = { x: track.pos.x + offset.x * clamp, y: track.pos.y + offset.y * clamp };
        const d = dist(p, predicted);
        if (d <= this.maxDistance) pairs.push({ i, j, d });
      });
    });
    pairs.sort((a, b) => a.d - b.d);

    const usedItems = new Set<number>();
    const usedTracks = new Set<number>();
    const seen: Track<T>[] = [];

    for (let k = 0; k < pairs.length; k++) {
      const { i, j, d } = pairs[k];
      if (usedItems.has(i) || usedTracks.has(j)) continue;

      // Ambiguity check: if another unused pair competes for the same detection (i)
      // or the same track (j) and is nearly as good, skip this match entirely.
      // This prevents ID swaps when two faces are close together.
      const isAmbiguous = pairs.some(
        (other, idx) =>
          idx !== k &&
          !usedItems.has(other.i) &&
          !usedTracks.has(other.j) &&
          (other.i === i || other.j === j) &&
          (d === 0 ? other.d === 0 : other.d < d / AMBIGUITY_RATIO),
      );
      if (isAmbiguous) continue;

      usedItems.add(i);
      usedTracks.add(j);
      const track = this.tracks[j];
      const dt = now - track.lastSeen;
      if (dt > 0 && dt <= (this.options.predictionMs ?? 0)) {
        this.velocities.set(track.id, { x: (positions[i].x - track.pos.x) / dt,
          y: (positions[i].y - track.pos.y) / dt });
      } else this.velocities.delete(track.id);
      track.item = items[i];
      track.pos = positions[i];
      track.lastSeen = now;
      seen.push(track);
    }

    items.forEach((item, i) => {
      if (usedItems.has(i)) return;
      // An unresolved face keeps its existing tracks stale; inventing another ID
      // here would compete with those same tracks for the next 2.5 seconds.
      if (this.options.deferAmbiguous && pairs.some(pair => pair.i === i && !usedTracks.has(pair.j))) return;
      const track: Track<T> = { id: this.nextId++, item, pos: positions[i], lastSeen: now };
      this.tracks.push(track);
      seen.push(track);
    });

    this.tracks = this.tracks.filter((t) => now - t.lastSeen <= this.maxMissedMs);
    return seen;
  }

  /** All live tracks, including ones missed recently (they keep their last item). */
  alive(): Track<T>[] {
    return this.tracks;
  }

  reset(): void {
    this.tracks = [];
    this.velocities.clear();
  }
}
