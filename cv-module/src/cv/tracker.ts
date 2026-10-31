import { dist } from "./geometry";
import type { Point } from "./types";

export interface Track<T> {
  id: number;
  item: T;
  pos: Point;
  lastSeen: number;
}

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

  constructor(
    private maxDistance: number,
    private maxMissedMs: number,
  ) {}

  /** Returns the tracks matched or created in this frame. */
  update(items: T[], posOf: (item: T) => Point, now: number): Track<T>[] {
    const positions = items.map(posOf);

    const pairs: { i: number; j: number; d: number }[] = [];
    positions.forEach((p, i) => {
      this.tracks.forEach((track, j) => {
        const d = dist(p, track.pos);
        if (d <= this.maxDistance) pairs.push({ i, j, d });
      });
    });
    pairs.sort((a, b) => a.d - b.d);

    const usedItems = new Set<number>();
    const usedTracks = new Set<number>();
    const seen: Track<T>[] = [];

    for (const { i, j } of pairs) {
      if (usedItems.has(i) || usedTracks.has(j)) continue;
      usedItems.add(i);
      usedTracks.add(j);
      const track = this.tracks[j];
      track.item = items[i];
      track.pos = positions[i];
      track.lastSeen = now;
      seen.push(track);
    }

    items.forEach((item, i) => {
      if (usedItems.has(i)) return;
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
  }
}
