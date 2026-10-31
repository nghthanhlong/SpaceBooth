# SpaceBooth CV module

Module computer vision của SpaceBooth: nhận diện tay và mặt bằng MediaPipe, khóa người điều khiển, con trỏ có khử rung, cử chỉ gắp, chụp bằng chữ V và Smart Snap-to-Face.
Module **không phụ thuộc React**. UI chỉ cần lắng nghe event.

## Chạy

```bash
npm install        # tự copy wasm và tải model vào public/mediapipe (chạy được offline)
npm run dev        # mở http://localhost:5173
```

Ở trang debug có hai nút:
- **Start camera + CV**: chạy thật bằng webcam.
- **Mock mode**: chuột thay cho tay. Rê chuột là con trỏ, nhấn giữ là gắp, phím `A`/`R`/`V` là activate/release/capture. Dùng khi làm UI mà không cần camera.

Phím tắt: `1`–`4` chọn sticker, `M` đánh dấu "người dùng định làm cử chỉ" (ground truth để đo accuracy), `X` nhả quyền điều khiển.

## Cấu trúc

```
src/cv/            module CV, đem sang app React được ngay
  engine.ts        pipeline: webcam -> GestureRecognizer + FaceLandmarker -> tracking -> events
  controller.ts    khóa người điều khiển (dwell bàn tay mở, mất dấu, luật chụp chữ V)
  tracker.ts       gán ID ổn định cho tay và mặt (nearest-neighbor)
  pinch.ts         phát hiện gắp: hysteresis + debounce, chuẩn hóa theo kích thước bàn tay
  oneEuro.ts       bộ lọc One-Euro khử rung con trỏ
  snap.ts          Smart Snap-to-Face: điểm neo sticker, scale theo khoảng cách mắt, xoay theo góc nghiêng đầu
  logger.ts        ghi log JSON cho phần đánh giá (FPS, latency p50/p95, số lần kích hoạt và gắp)
  mock.ts          bản giả bằng chuột và bàn phím
src/debug/         overlay vẽ landmark, chỉ dùng cho trang debug
scripts/setup-assets.mjs   copy wasm và tải model
```

## Dùng trong app React

```ts
import { CvEngine } from "./cv";

const cv = new CvEngine(videoElement);           // hoặc new MockCv(stageElement)
cv.on("activate", ({ handId }) => ...);
cv.on("dwellProgress", ({ progress }) => ...);   // vẽ vòng tiến trình
cv.on("cursor", ({ x, y }) => ...);              // [0,1] trên khung video đang hiển thị
cv.on("pinchStart", (p) => ...);
cv.on("pinchEnd", (p) => ...);
cv.on("captureProgress", ({ progress }) => ...);
cv.on("capture", () => startCountdown());
cv.on("frame", (f) => ...);                      // f.faces dùng để placeSticker()
await cv.start();
```

Lưu ý:
- Landmark đã được **lật gương** (x = 1 − x). Video hiển thị bằng `transform: scaleX(-1)`, còn canvas thì **không** lật.
- `cursor` tính trên khung video. Khung hiển thị phải giữ đúng tỉ lệ của video (không crop), nếu không sticker sẽ lệch.

## Tham số cần tinh chỉnh (xem `DEFAULT_ENGINE` trong `engine.ts`)

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `controller.dwellMs` | 1500 | Thời gian giữ bàn tay mở để nhận quyền điều khiển |
| `controller.lostTimeoutMs` | 1500 | Mất tay quá thời gian này thì nhả quyền |
| `controller.captureMinHands` | 2 | Số tay giơ chữ V cần có để chụp (hoặc chỉ cần controller giơ) |
| `pinch.startRatio` / `releaseRatio` | 0.25 / 0.40 | Ngưỡng gắp và thả (hysteresis) |
| `cursorFilter.minCutoff` / `beta` | 1.0 / 5.0 | One-Euro: giảm `minCutoff` để bớt rung, tăng `beta` để bớt trễ |
| `interactionBox` | 0.15–0.85 × 0.1–0.8 | Vùng camera ứng với toàn màn hình. Vùng nhỏ hơn thì tay di chuyển ít hơn, đỡ mỏi |
| `numHands` / `numFaces` / `faceEveryNFrames` | 6 / 7 / 2 | Đánh đổi giữa độ chính xác khi đông người và FPS |
