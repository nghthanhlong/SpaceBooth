import { describe, expect, it } from "vitest";
import { StickerPoseFilter } from "./stickerPoseFilter";

const size = { width: 1280, height: 720 };
const pose = (x: number, angle = 0) => ({ x, y: 200, width: 100, angle });

describe("sticker pose filtering", () => {
  it("ignores duplicate repaints of the same detection", () => {
    const a = new StickerPoseFilter(), b = new StickerPoseFilter();
    a.update(pose(100), 0, size); b.update(pose(100), 0, size);
    const once = a.update(pose(102), 33, size);
    b.update(pose(102), 33, size);
    for (let i = 0; i < 8; i++) expect(b.update(pose(102), 33, size)).toEqual(once);
    expect(a.update(pose(104), 66, size)).toEqual(b.update(pose(104), 66, size));
  });

  it("reduces stationary jitter without trailing fast movement", () => {
    const filter = new StickerPoseFilter();
    filter.update(pose(100), 0, size);
    const small = filter.update(pose(101), 33, size);
    expect(small.x).toBeGreaterThan(100);
    expect(small.x).toBeLessThan(100.8);
    const moving = filter.update(pose(160), 66, size);
    expect(Math.abs(moving.x - 160)).toBeLessThan(1);
  });

  it("unwraps rotation and resets after missing data or a resolution change", () => {
    const filter = new StickerPoseFilter();
    filter.update(pose(100, Math.PI - 0.02), 0, size);
    expect(filter.update(pose(100, -Math.PI + 0.02), 33, size).angle).toBeGreaterThan(3);
    expect(filter.update(pose(300), 400, size)).toEqual(pose(300));
    expect(filter.update(pose(200), 433, { width: 640, height: 480 })).toEqual(pose(200));
    filter.reset();
    expect(filter.update(pose(400), 466, size)).toEqual(pose(400));
  });
});
