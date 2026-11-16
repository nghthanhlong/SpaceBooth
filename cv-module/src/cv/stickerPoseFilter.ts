import type { Placement } from "./snap";
import type { FrameSize } from "./types";

const alpha = (dt: number, cutoff: number) => 1 - Math.exp(-2 * Math.PI * cutoff * dt);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Consume each detection once. Smooth jitter at rest and follow fast motion
 * with less delay; repeated canvas repaints must not change filter response. */
export class StickerPoseFilter {
  private pose: Placement | null = null;
  private raw: Placement | null = null;
  private at = 0;
  private size: FrameSize | null = null;

  reset() { this.pose = this.raw = null; }

  update(raw: Placement, observedAt: number, size: FrameSize): Placement {
    if (!this.pose || !this.raw || this.size?.width !== size.width || this.size?.height !== size.height ||
        observedAt - this.at > 300 || observedAt < this.at) {
      this.pose = { ...raw };
    } else if (observedAt === this.at) return this.pose;
    else {
      const dt = (observedAt - this.at) / 1000;
      const scale = Math.max(raw.width, this.raw.width, 1);
      const speed = Math.hypot(raw.x - this.raw.x, raw.y - this.raw.y) / scale / dt;
      const positionAlpha = alpha(dt, 4 + 12 * speed);
      const scaleSpeed = Math.abs(Math.log(raw.width / this.raw.width)) / dt;
      const turnSpeed = Math.abs(angleDelta(this.raw.angle, raw.angle)) / dt;
      this.pose = {
        x: mix(this.pose.x, raw.x, positionAlpha),
        y: mix(this.pose.y, raw.y, positionAlpha),
        width: Math.exp(mix(Math.log(this.pose.width), Math.log(raw.width), alpha(dt, 4 + 6 * scaleSpeed))),
        angle: this.pose.angle + angleDelta(this.pose.angle, raw.angle) * alpha(dt, 4 + 4 * turnSpeed),
      };
    }
    this.raw = { ...raw };
    this.at = observedAt;
    this.size = { ...size };
    return this.pose;
  }
}
