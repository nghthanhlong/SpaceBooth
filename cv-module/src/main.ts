// Debug playground for the CV module: landmarks, controller lock, pinch, snap-to-face, stats, logging.
import "./style.css";
import {
  CvEngine,
  EventLogger,
  MockCv,
  findSnapTarget,
  placeSticker,
  type CvSource,
  type FrameInfo,
  type FrameSize,
  type Placement,
  type Point,
  type StickerKind,
} from "./cv";
import { drawCountdown, drawCursor, drawEmoji, drawFrame, drawRing } from "./debug/overlay";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const video = $<HTMLVideoElement>("#cam");
const canvas = $<HTMLCanvasElement>("#overlay");
const stage = $<HTMLDivElement>("#stage");
const statsEl = $<HTMLPreElement>("#stats");
const eventsEl = $<HTMLOListElement>("#events");
const statusEl = $<HTMLSpanElement>("#status");
const ctx = canvas.getContext("2d")!;

const STICKER_EMOJI: Record<StickerKind, string> = {
  glasses: "🕶️",
  bunnyEars: "🐰",
  hat: "🎩",
  lips: "💋",
};
const STICKER_KEYS: Record<string, StickerKind> = { "1": "glasses", "2": "bunnyEars", "3": "hat", "4": "lips" };

interface PlacedSticker {
  kind: StickerKind;
  /** Attached face, or null when dropped away from any face. */
  faceId: number | null;
  pos: Point;
  /** Last pose drawn, used when the attached face is lost. */
  last: Placement | null;
}

const logger = new EventLogger();
let source: CvSource | null = null;
let engine: CvEngine | null = null;
let frame: FrameInfo | null = null;
let cursor: Point | null = null;
let pinching = false;
let captureProgress = 0;
let secondsLeft = 0;
let cameraInfo = "-";
// Camera width, e.g. ?w=640 to compare speed vs. landmark quality at a distance.
const camWidth = Number(new URLSearchParams(location.search).get("w")) || 1280;
let flashUntil = 0;
let currentKind: StickerKind = "glasses";
let held: StickerKind | null = null;
let placed: PlacedSticker[] = [];

const frameSize = (): FrameSize => frame?.size ?? { width: canvas.width, height: canvas.height };
const toPx = (p: Point, s = frameSize()): Point => ({ x: p.x * s.width, y: p.y * s.height });

function logEvent(text: string) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  eventsEl.prepend(li);
  while (eventsEl.children.length > 30) eventsEl.lastChild?.remove();
}

function wire(src: CvSource) {
  src.on("cursor", (p) => (cursor = p));
  src.on("frame", (f) => (frame = f));
  src.on("activate", ({ handId }) => logEvent(`activate: hand #${handId} takes control`));
  src.on("release", ({ handId, reason }) => {
    cursor = null;
    logEvent(`release: hand #${handId} (${reason})`);
  });
  src.on("captureProgress", ({ progress }) => (captureProgress = progress));
  src.on("countdownStart", ({ durationMs, victoryHands }) => {
    captureProgress = 0;
    logEvent(`countdown ${durationMs / 1000}s (${victoryHands} Victory hand(s))`);
  });
  src.on("countdown", (e) => (secondsLeft = e.secondsLeft));
  src.on("capture", ({ victoryHands }) => {
    flashUntil = performance.now() + 400;
    captureProgress = 0;
    secondsLeft = 0;
    logEvent(`CAPTURE (${victoryHands} Victory hand(s))`);
  });
  src.on("pinchStart", () => {
    pinching = true;
    held = currentKind;
    logEvent(`pinchStart: grab ${held}`);
  });
  src.on("pinchEnd", (p) => {
    pinching = false;
    if (!held) return;
    const size = frameSize();
    const drop = toPx(p, size);
    const target = findSnapTarget(drop, frame?.faces ?? [], held, size);
    placed.push({ kind: held, faceId: target?.face.id ?? null, pos: drop, last: target?.placement ?? null });
    logger.record("drop", { kind: held, snapped: target !== null, faceId: target?.face.id ?? null });
    logEvent(target ? `drop: ${held} snapped to face #${target.face.id}` : `drop: ${held} missed (no face nearby)`);
    held = null;
  });
  logger.attach(src);
}

function resetState() {
  source?.stop();
  source = null;
  engine = null;
  frame = null;
  cursor = null;
  pinching = false;
  held = null;
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: camWidth }, height: { ideal: (camWidth * 9) / 16 }, frameRate: { ideal: 30 }, facingMode: "user" },
    audio: false,
  });
  const cam = stream.getVideoTracks()[0].getSettings();
  cameraInfo = `${cam.width}x${cam.height} @ ${cam.frameRate?.toFixed(0) ?? "?"} fps`;
  video.srcObject = stream;
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
}

$<HTMLButtonElement>("#btn-cv").onclick = async () => {
  resetState();
  try {
    statusEl.textContent = "Starting camera...";
    await startCamera();
    statusEl.textContent = "Loading models...";
    engine = new CvEngine(video);
    wire(engine);
    await engine.start();
    source = engine;
    statusEl.textContent = "CV running. Hold an open palm to take control.";
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Error: ${(err as Error).message}`;
  }
};

$<HTMLButtonElement>("#btn-mock").onclick = async () => {
  resetState();
  const mock = new MockCv(stage);
  wire(mock);
  await mock.start();
  source = mock;
  statusEl.textContent = "Mock mode: mouse = cursor, click = pinch, A/R/V = activate/release/countdown";
};

$<HTMLButtonElement>("#btn-log").onclick = () => logger.download();
$<HTMLButtonElement>("#btn-clear").onclick = () => {
  placed = [];
  logger.reset();
  eventsEl.replaceChildren();
};

window.addEventListener("keydown", (e) => {
  const kind = STICKER_KEYS[e.key];
  if (kind) currentKind = kind;
  // Ground truth for accuracy: the tester presses M whenever the user INTENDS a gesture.
  if (e.key.toLowerCase() === "m") {
    logger.mark("intent");
    logEvent("mark: intent");
  }
  if (e.key.toLowerCase() === "x") engine?.releaseControl();
});

function render() {
  const size = frameSize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (frame) drawFrame(ctx, frame);

  for (const s of placed) {
    let pl: Placement;
    if (s.faceId === null) {
      pl = { ...s.pos, width: 80, angle: 0 };
    } else {
      let face = frame?.faces.find((f) => f.id === s.faceId);
      if (!face && s.last) {
        // The face came back with a new id: re-attach to the face nearest to where the sticker was.
        face = findSnapTarget(s.last, frame?.faces ?? [], s.kind, size)?.face;
        if (face) s.faceId = face.id;
      }
      if (!face) {
        if (s.last) drawEmoji(ctx, STICKER_EMOJI[s.kind], s.last, 0.4);
        continue;
      }
      pl = placeSticker(face, s.kind, size);
      s.last = pl;
    }
    drawEmoji(ctx, STICKER_EMOJI[s.kind], pl);
  }

  if (cursor) {
    const c = toPx(cursor, size);
    if (held) {
      // Preview where the sticker would snap if released now.
      const target = findSnapTarget(c, frame?.faces ?? [], held, size);
      if (target) drawEmoji(ctx, STICKER_EMOJI[held], target.placement, 0.5);
      drawEmoji(ctx, STICKER_EMOJI[held], { ...c, width: 70, angle: 0 }, 0.9);
    }
    drawCursor(ctx, c, pinching);
    if (captureProgress > 0) drawRing(ctx, c, 36, captureProgress, "#facc15");
  }

  if (secondsLeft > 0) drawCountdown(ctx, secondsLeft, size);

  if (performance.now() < flashUntil) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  statsEl.textContent = statsText();
  requestAnimationFrame(render);
}

function statsText(): string {
  const lines = [`camera   : ${cameraInfo}`, `sticker  : ${currentKind} (keys 1-4)`, `placed   : ${placed.length}`];
  if (frame) {
    const { stats, controller } = frame;
    const ctrl =
      controller.kind === "idle"
        ? "idle"
        : controller.kind === "arming"
          ? `arming #${controller.handId} ${(controller.progress * 100).toFixed(0)}%`
          : `locked #${controller.handId}`;
    lines.unshift(
      `fps      : ${stats.fps.toFixed(1)}`,
      `gesture  : ${stats.gestureMs.toFixed(1)} ms`,
      `face     : ${stats.faceUpdated ? `${stats.faceMs.toFixed(1)} ms` : "(skipped)"}`,
      `total    : ${stats.totalMs.toFixed(1)} ms`,
      `hands    : ${frame.hands.length}   faces: ${frame.faces.length}`,
      `control  : ${ctrl}`,
      `pinch    : ${pinching ? "YES" : "no"}  ratio ${frame.pinchRatio?.toFixed(2) ?? "-"}`,
    );
  }
  const counts = logger.counts();
  lines.push("", "log:", ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`));
  return lines.join("\n");
}

requestAnimationFrame(render);
