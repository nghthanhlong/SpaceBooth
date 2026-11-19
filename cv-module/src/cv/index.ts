// Public API of the CV module. The React app should only import from here.
export { CvEngine, DEFAULT_ENGINE, type CvSource, type EngineConfig } from "./engine";
export { MockCv } from "./mock";
export { EventLogger } from "./logger";
export {
  findSmartSnapTarget,
  findSnapTarget,
  placeSticker,
  STICKER_ANCHORS,
  STICKER_SLOTS,
  type StickerSlot,
  type Placement,
  type StickerKind,
  type SnapTarget,
} from "./snap";
export {
  DEFAULT_CONTROLLER,
  ControllerLock,
  type ControllerConfig,
  type AcquireControllerOptions,
} from "./controller";
export { DEFAULT_PINCH, type PinchConfig } from "./pinch";
export { DEFAULT_POINT, PointDetector, type PointConfig } from "./point";
export { FACE, HAND } from "./landmarks";
export { DEFAULT_TRACKING_CONFIG } from "./types";
export type * from "./types";
// Keep the segmentation task resolved from the same SDK as the existing CV engine.
export { ImageSegmenter as HairImageSegmenter, FilesetResolver as HairFilesetResolver } from "@mediapipe/tasks-vision";
