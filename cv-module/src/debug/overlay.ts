import { GestureRecognizer } from "@mediapipe/tasks-vision";
import { HAND } from "../cv/landmarks";
import type { Placement } from "../cv/snap";
import type { FrameInfo, FrameSize, Point } from "../cv/types";

const COLORS = {
  controller: "#22d3ee",
  otherHand: "rgba(255,255,255,0.45)",
  face: "rgba(250,204,21,0.55)",
  dwell: "#a3e635",
};

/** Draws landmarks, ids, gestures and the dwell ring for one frame. */
export function drawFrame(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  const { width: w, height: h } = f.size;
  const controllerId = f.controller.kind === "locked" ? f.controller.handId : null;

  ctx.lineWidth = 3;
  ctx.font = "16px system-ui, sans-serif";

  for (const face of f.faces) {
    ctx.fillStyle = COLORS.face;
    for (let i = 0; i < face.landmarks.length; i += 4) {
      const p = face.landmarks[i];
      ctx.fillRect(p.x * w - 1, p.y * h - 1, 2, 2);
    }
    const top = face.landmarks[10];
    label(ctx, `face #${face.id}`, top.x * w, top.y * h - 10, COLORS.face);
  }

  for (const hand of f.hands) {
    const color = hand.id === controllerId ? COLORS.controller : COLORS.otherHand;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const { start, end } of GestureRecognizer.HAND_CONNECTIONS) {
      const a = hand.landmarks[start];
      const b = hand.landmarks[end];
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
    }
    ctx.stroke();

    const wrist = hand.landmarks[HAND.WRIST];
    const text = `#${hand.id} ${hand.gesture} ${(hand.gestureScore * 100).toFixed(0)}%`;
    label(ctx, text, wrist.x * w, wrist.y * h + 24, color);

    if (f.controller.kind === "arming" && f.controller.handId === hand.id) {
      drawRing(ctx, { x: wrist.x * w, y: wrist.y * h }, 40, f.controller.progress, COLORS.dwell);
    }
  }
}

export function drawCursor(ctx: CanvasRenderingContext2D, p: Point, pinching: boolean): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, pinching ? 10 : 16, 0, Math.PI * 2);
  ctx.fillStyle = pinching ? "#f472b6" : "rgba(34,211,238,0.35)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = pinching ? "#f472b6" : COLORS.controller;
  ctx.stroke();
}

export function drawRing(ctx: CanvasRenderingContext2D, c: Point, r: number, progress: number, color: string): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.stroke();
}

export function drawCountdown(ctx: CanvasRenderingContext2D, secondsLeft: number, size: FrameSize): void {
  ctx.save();
  ctx.font = `bold ${Math.round(size.height * 0.35)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(String(secondsLeft), size.width / 2, size.height / 2);
  ctx.fillStyle = "#facc15";
  ctx.fillText(String(secondsLeft), size.width / 2, size.height / 2);
  ctx.restore();
}

export function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, pl: Placement, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(pl.x, pl.y);
  ctx.rotate(pl.angle);
  ctx.font = `${pl.width}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 0, 0);
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  const width = ctx.measureText(text).width;
  ctx.fillRect(x - 4, y - 16, width + 8, 22);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
