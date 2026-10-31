/**
 * Landmark indices used by the algorithms.
 * Hand map:  https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
 * Face mesh: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
 */
export const HAND = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
} as const;

/** "Left"/"Right" are from the subject's point of view. */
export const FACE = {
  NOSE_TIP: 1,
  FOREHEAD: 10,
  UPPER_LIP: 13,
  RIGHT_EYE_OUTER: 33,
  NOSE_BRIDGE: 168,
  LEFT_EYE_OUTER: 263,
} as const;
