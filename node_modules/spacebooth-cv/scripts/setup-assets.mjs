// Copies the MediaPipe WASM runtime and downloads the models into public/,
// so the demo works offline (no CDN needed at the event).
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}public/mediapipe`;
const frontendOut = `${root}../frontend/public/mediapipe`;

cpSync(`${root}node_modules/@mediapipe/tasks-vision/wasm`, `${out}/wasm`, { recursive: true });
console.log("Copied MediaPipe wasm -> public/mediapipe/wasm");

const MODELS = {
  "gesture_recognizer.task":
    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
  "face_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
};

mkdirSync(`${out}/models`, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const path = `${out}/models/${name}`;
  if (existsSync(path)) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    console.log(`Downloaded ${name}`);
  } catch (err) {
    // Do not fail `npm install` when offline; rerun `npm run setup` later.
    console.warn(`Could not download ${name}: ${err.message}. Run "npm run setup" again later.`);
  }
}

mkdirSync(frontendOut, { recursive: true });
cpSync(out, frontendOut, { recursive: true });
console.log("Copied MediaPipe assets -> frontend/public/mediapipe");
