import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_TRACKING_CONFIG,
  FACE,
  findSmartSnapTarget,
  findSnapTarget,
  placeSticker,
} from "spacebooth-cv";
import { STICKERS } from "../data/stickers";

function toPx(point, size) {
  return {
    x: point.x * size.width,
    y: point.y * size.height,
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

function isTransformFinite(pose) {
  return (
    pose &&
    Number.isFinite(pose.x) &&
    Number.isFinite(pose.y) &&
    Number.isFinite(pose.width) &&
    Number.isFinite(pose.angle) &&
    pose.width > 0
  );
}

export default function useStickers(customConfig = {}) {
  const configRef = useRef({ ...DEFAULT_TRACKING_CONFIG, ...customConfig });
  useEffect(() => {
    configRef.current = { ...DEFAULT_TRACKING_CONFIG, ...customConfig };
  }, [customConfig]);

  const imagesRef = useRef(new Map());
  const placementsRef = useRef([]);
  const targetRef = useRef(null);

  // Persistent sticker transforms & tracking state storage
  const preservedTransformsRef = useRef(new Map());
  const smoothedPosesRef = useRef(new Map());
  const recoveryStateRef = useRef(new Map());
  const snapAnimationRef = useRef(null);
  const overallTrackingStateRef = useRef("TRACKING");
  const lastValidFaceTimestampRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [placements, setPlacements] = useState([]);
  const [trackingState, setTrackingState] = useState("TRACKING");

  useEffect(() => {
    let active = true;

    Promise.all(
      STICKERS.map(
        (sticker) =>
          new Promise((resolve, reject) => {
            const image = new Image();

            image.onload = () => resolve([sticker.id, image]);
            image.onerror = () =>
              reject(new Error(`Không tải được sticker ${sticker.name}.`));

            image.src = sticker.src;
          }),
      ),
    )
      .then((entries) => {
        if (!active) return;
        imagesRef.current = new Map(entries);
        setReady(true);
      })
      .catch((error) => {
        if (active) setAssetError(error.message);
      });

    return () => {
      active = false;
    };
  }, []);

  const clearTarget = useCallback(() => {
    targetRef.current = null;
  }, []);

  const commitTarget = useCallback((target, kind) => {
    if (!target) return false;

    const item = {
      id: `${target.face.id}:${kind}`,
      faceId: target.face.id,
      kind,
    };

    const next = [
      ...placementsRef.current.filter((previous) => previous.id !== item.id),
      item,
    ];

    placementsRef.current = next;
    setPlacements(next);
    targetRef.current = null;

    // Trigger snapping animation effect
    snapAnimationRef.current = {
      faceId: target.face.id,
      kind,
      startTime: performance.now(),
      duration: 400,
    };

    return true;
  }, []);

  const autoSnapSticker = useCallback(
    (kind, faces, clientPoint = null, cameraStage = null) => {
      if (!faces || faces.length === 0) {
        return { success: false, reason: "no_face" };
      }

      let size = { width: 1280, height: 720 };
      let targetPoint = null;

      if (cameraStage) {
        const canvas = cameraStage.querySelector(".camera-layer");
        const rect = cameraStage.getBoundingClientRect();
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          size = { width: canvas.width, height: canvas.height };
        }
        if (
          clientPoint &&
          rect.width > 0 &&
          rect.height > 0 &&
          Number.isFinite(clientPoint.x) &&
          Number.isFinite(clientPoint.y)
        ) {
          targetPoint = {
            x: ((clientPoint.x - rect.left) / rect.width) * size.width,
            y: ((clientPoint.y - rect.top) / rect.height) * size.height,
          };
        }
      }

      const snapTarget = findSmartSnapTarget(faces, kind, size, targetPoint);
      if (!snapTarget) {
        return { success: false, reason: "no_reliable_face" };
      }

      const committed = commitTarget(snapTarget, kind);
      return {
        success: committed,
        faceId: snapTarget.face.id,
        kind,
      };
    },
    [commitTarget],
  );

  const findTarget = useCallback((clientPoint, kind, cameraStage, data) => {
    if (!cameraStage || !data) {
      targetRef.current = null;
      return null;
    }

    const canvas = cameraStage.querySelector(".camera-layer");
    const rect = cameraStage.getBoundingClientRect();

    if (
      !canvas ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      clientPoint.x < rect.left ||
      clientPoint.x > rect.right ||
      clientPoint.y < rect.top ||
      clientPoint.y > rect.bottom
    ) {
      targetRef.current = null;
      return null;
    }

    const size = {
      width: canvas.width,
      height: canvas.height,
    };

    const drop = {
      x: ((clientPoint.x - rect.left) / rect.width) * size.width,
      y: ((clientPoint.y - rect.top) / rect.height) * size.height,
    };

    const faces = data.faces.filter((face) => !face.stale);
    const target = findSnapTarget(drop, faces, kind, size);

    targetRef.current = target
      ? { faceId: target.face.id, kind }
      : null;

    return target;
  }, []);

  const removeSticker = useCallback((id) => {
    const next = placementsRef.current.filter((item) => item.id !== id);
    placementsRef.current = next;
    setPlacements(next);
    preservedTransformsRef.current.delete(id);
    smoothedPosesRef.current.delete(id);
    recoveryStateRef.current.delete(id);
  }, []);

  const clearStickers = useCallback(() => {
    placementsRef.current = [];
    targetRef.current = null;
    preservedTransformsRef.current.clear();
    smoothedPosesRef.current.clear();
    recoveryStateRef.current.clear();
    snapAnimationRef.current = null;
    setPlacements([]);
  }, []);

  /**
   * Main sticker rendering loop with robust fallback & tracking state machine:
   * 1. TRACKING: Live face detected -> compute pose, smooth, update preserved transform.
   * 2. TEMPORARY_HOLD: Face missing briefly -> render with preserved transform.
   * 3. RECOVERY: Face returns -> verify geometry & interpolate smoothly.
   * 4. TRACKING_LOST: Tracking missing beyond timeout (>2000ms).
   */
  const drawStickers = useCallback(
    (ctx, size, faces = [], isLive = false, options = {}) => {
      const config = configRef.current;
      const now = performance.now();
      const snapAnim = snapAnimationRef.current;
      const isSnapshot = Boolean(options.snapshot);

      // Verify active faces in this frame
      const activeFaces = faces.filter((f) => !f.stale && f.landmarks && f.landmarks.length > 0);
      if (activeFaces.length > 0) {
        lastValidFaceTimestampRef.current = now;
      }

      let worstState = "TRACKING";

      function drawImagePose(image, pose, opacity = 1) {
        const height = pose.width * (image.naturalHeight / image.naturalWidth);

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(pose.x, pose.y);
        ctx.rotate(pose.angle);
        ctx.drawImage(
          image,
          -pose.width / 2,
          -height / 2,
          pose.width,
          height,
        );
        ctx.restore();
      }

      for (const item of placementsRef.current) {
        const image = imagesRef.current.get(item.kind);
        if (!image) continue;

        let face = faces.find((candidate) => candidate.id === item.faceId);

        // Position-based re-identification: when the tracked faceId is gone entirely
        // (IdTracker purged it), try to match a nearby active face by nose position.
        if (!face) {
          const poseKeyEarly = item.id;
          const preservedEarly = preservedTransformsRef.current.get(poseKeyEarly);
          if (preservedEarly && preservedEarly.faceCenter && isTransformFinite(preservedEarly)) {
            const radius = Math.max(preservedEarly.eyeDistance * 1.5, 120);
            const reidentified = faces.find((f) => {
              if (f.stale || !f.landmarks || !f.landmarks.length) return false;
              const nosePx = toPx(f.landmarks[FACE.NOSE_TIP], size);
              return dist(nosePx, preservedEarly.faceCenter) <= radius;
            });
            if (reidentified) {
              face = reidentified;
              item.faceId = reidentified.id;
            }
          }
        }

        const isFaceActive = Boolean(face && !face.stale && face.landmarks && face.landmarks.length > 0);

        const poseKey = item.id;
        const preserved = preservedTransformsRef.current.get(poseKey);

        if (isFaceActive) {
          // 1. Live face tracking is ACTIVE
          const rawPose = placeSticker(face, item.kind, size);
          if (!isTransformFinite(rawPose)) continue;

          const nosePx = toPx(face.landmarks[FACE.NOSE_TIP], size);
          const eyeAPx = toPx(face.landmarks[FACE.RIGHT_EYE_OUTER], size);
          const eyeBPx = toPx(face.landmarks[FACE.LEFT_EYE_OUTER], size);
          const eyeDistance = dist(eyeAPx, eyeBPx);

          let finalPose = rawPose;
          let currentState = "TRACKING";

          // Check if recovering from temporary hold or lost state
          const wasHoldingOrLost =
            preserved &&
            (preserved.trackingState === "TEMPORARY_HOLD" ||
              preserved.trackingState === "TRACKING_LOST");

          if (wasHoldingOrLost) {
            // Verify face identity geometry match
            const isMatch =
              !preserved.faceCenter ||
              dist(nosePx, preserved.faceCenter) <= Math.max(eyeDistance * 2.2, 180);

            if (isMatch) {
              recoveryStateRef.current.set(poseKey, {
                fromPose: {
                  x: preserved.x,
                  y: preserved.y,
                  width: preserved.width,
                  angle: preserved.angle,
                },
                startTime: now,
                duration: config.recoveryInterpolationDurationMs,
              });
              currentState = "RECOVERY";
            }
          }

          // Handle smooth recovery interpolation
          const recovery = recoveryStateRef.current.get(poseKey);
          if (recovery) {
            const elapsed = now - recovery.startTime;
            const t = Math.min(1, elapsed / recovery.duration);

            finalPose = {
              x: lerp(recovery.fromPose.x, rawPose.x, t),
              y: lerp(recovery.fromPose.y, rawPose.y, t),
              width: lerp(recovery.fromPose.width, rawPose.width, t),
              angle: lerpAngle(recovery.fromPose.angle, rawPose.angle, t),
            };

            if (t >= 1) {
              recoveryStateRef.current.delete(poseKey);
              currentState = "TRACKING";
            } else {
              currentState = "RECOVERY";
            }
          } else {
            // Normal exponential smoothing (alpha = 0.8)
            const prev = smoothedPosesRef.current.get(poseKey);
            if (prev) {
              finalPose = {
                x: prev.x * 0.2 + rawPose.x * 0.8,
                y: prev.y * 0.2 + rawPose.y * 0.8,
                width: prev.width * 0.2 + rawPose.width * 0.8,
                angle: lerpAngle(prev.angle, rawPose.angle, 0.8),
              };
            }
          }

          smoothedPosesRef.current.set(poseKey, finalPose);

          // Update preserved transform
          preservedTransformsRef.current.set(poseKey, {
            faceId: item.faceId,
            stickerId: item.id,
            kind: item.kind,
            x: finalPose.x,
            y: finalPose.y,
            width: finalPose.width,
            angle: finalPose.angle,
            lastValidTime: now,
            trackingState: currentState,
            faceCenter: nosePx,
            eyeDistance,
          });

          // Check snapping pop animation
          let extraScale = 1;
          if (
            snapAnim &&
            snapAnim.faceId === face.id &&
            snapAnim.kind === item.kind &&
            now - snapAnim.startTime < snapAnim.duration
          ) {
            const progress = (now - snapAnim.startTime) / snapAnim.duration;
            extraScale = 1 + Math.sin(progress * Math.PI) * 0.25;
          }

          const drawPose = {
            ...finalPose,
            width: finalPose.width * extraScale,
          };

          drawImagePose(image, drawPose, 1.0);

          if (currentState === "RECOVERY" && worstState === "TRACKING") {
            worstState = "RECOVERY";
          }
        } else {
          // 2. Face tracking is TEMPORARILY UNAVAILABLE
          if (preserved && isTransformFinite(preserved)) {
            const elapsedSinceValid = now - preserved.lastValidTime;

            let holdState = "TEMPORARY_HOLD";
            if (elapsedSinceValid <= config.shortInterruptionMs) {
              holdState = "TRACKING";
            } else if (elapsedSinceValid <= config.temporaryHoldMs) {
              holdState = "TEMPORARY_HOLD";
            } else if (elapsedSinceValid <= config.lostTimeoutMs) {
              holdState = "TEMPORARY_HOLD";
            } else {
              holdState = "TRACKING_LOST";
            }

            preserved.trackingState = holdState;

            // Decision to render fallback transform:
            // - In Snapshot: allow valid preserved transforms up to maxSnapshotTransformAgeMs (3000ms)
            // - In Live preview: allow up to lostTimeoutMs (2000ms)
            const canRenderFallback = isSnapshot
              ? elapsedSinceValid <= config.maxSnapshotTransformAgeMs
              : elapsedSinceValid <= config.lostTimeoutMs;

            if (canRenderFallback) {
              // Draw using preserved transform so sticker does not disappear!
              const opacity = isSnapshot ? 1.0 : 0.88;
              drawImagePose(image, preserved, opacity);
            }

            // Escalate worstState
            if (holdState === "TRACKING_LOST") {
              worstState = "TRACKING_LOST";
            } else if (holdState === "TEMPORARY_HOLD" && worstState !== "TRACKING_LOST") {
              worstState = "TEMPORARY_HOLD";
            }
          } else {
            worstState = "TRACKING_LOST";
          }
        }
      }

      // Update overall tracking state
      if (placementsRef.current.length === 0) {
        worstState = activeFaces.length > 0 ? "TRACKING" : "TRACKING_LOST";
      }

      if (overallTrackingStateRef.current !== worstState) {
        overallTrackingStateRef.current = worstState;
        setTrackingState(worstState);
      }

      // Draw preview target if dragging/dwelling
      if (isLive && targetRef.current) {
        const target = targetRef.current;
        const face = faces.find(
          (candidate) => candidate.id === target.faceId && !candidate.stale,
        );

        if (face) {
          const img = imagesRef.current.get(target.kind);
          if (img) {
            const rawPose = placeSticker(face, target.kind, size);
            if (isTransformFinite(rawPose)) {
              drawImagePose(img, rawPose, 0.55);
            }
          }
        }
      }
    },
    [],
  );

  /**
   * Retrieves high-level tracking status for UI feedback and countdown synchronization.
   */
  const getTrackingStatus = useCallback(() => {
    const config = configRef.current;
    const now = performance.now();
    const hasPlacements = placementsRef.current.length > 0;
    const timeSinceValidMs = now - lastValidFaceTimestampRef.current;
    const currentState = overallTrackingStateRef.current;

    let message = "Đang nhận diện khuôn mặt";
    if (currentState === "TEMPORARY_HOLD") {
      message = "Đang giữ vị trí sticker...";
    } else if (currentState === "RECOVERY") {
      message = "Đã nhận diện lại khuôn mặt";
    } else if (currentState === "TRACKING_LOST") {
      message = "Không nhận diện được khuôn mặt. Hãy nhìn về phía camera.";
    }

    return {
      state: currentState,
      timeSinceValidMs,
      hasPlacements,
      placementsCount: placementsRef.current.length,
      validTransformsCount: Array.from(preservedTransformsRef.current.values()).filter(
        (t) => isTransformFinite(t) && now - t.lastValidTime <= config.maxSnapshotTransformAgeMs,
      ).length,
      message,
    };
  }, []);

  /**
   * Pre-snapshot validation:
   * Ensures that every placed sticker has a valid, safe transform before taking the photo.
   */
  const validateSnapshotTransforms = useCallback(() => {
    const config = configRef.current;
    const now = performance.now();
    const items = placementsRef.current;

    if (items.length === 0) {
      return { valid: true, transforms: [] };
    }

    const validTransforms = [];
    for (const item of items) {
      const transform = preservedTransformsRef.current.get(item.id);
      if (!transform || !isTransformFinite(transform)) {
        return {
          valid: false,
          reason: `Sticker ${item.kind} chưa có vị trí hợp lệ.`,
          transforms: [],
        };
      }

      const age = now - transform.lastValidTime;
      if (age > config.maxSnapshotTransformAgeMs) {
        return {
          valid: false,
          reason: `Vị trí sticker ${item.kind} đã quá cũ (${Math.round(age)}ms).`,
          transforms: [],
        };
      }

      validTransforms.push(transform);
    }

    return { valid: true, transforms: validTransforms };
  }, []);

  /**
   * Diagnostic runtime values for Debug Mode.
   */
  const getDebugInfo = useCallback((faces = []) => {
    const now = performance.now();
    const activeFaces = faces.filter((f) => !f.stale);
    const transforms = Array.from(preservedTransformsRef.current.values()).map((t) => ({
      stickerId: t.stickerId,
      faceId: t.faceId,
      kind: t.kind,
      x: Math.round(t.x),
      y: Math.round(t.y),
      width: Math.round(t.width),
      angle: Number(t.angle.toFixed(3)),
      ageMs: Math.round(now - t.lastValidTime),
      state: t.trackingState,
      valid: isTransformFinite(t) && now - t.lastValidTime <= configRef.current.maxSnapshotTransformAgeMs,
    }));

    return {
      trackingState: overallTrackingStateRef.current,
      lastValidTrackingTimestamp: lastValidFaceTimestampRef.current,
      frameAgeMs: Math.round(now - lastValidFaceTimestampRef.current),
      activeFaceCount: activeFaces.length,
      activeFaceIds: faces.map((f) => `#${f.id}${f.stale ? "(stale)" : ""}`),
      placementsCount: placementsRef.current.length,
      preservedTransforms: transforms,
      snapshotValid: validateSnapshotTransforms().valid,
      config: configRef.current,
    };
  }, [validateSnapshotTransforms]);

  return {
    ready,
    assetError,
    placements,
    trackingState,
    autoSnapSticker,
    findTarget,
    commitTarget,
    clearTarget,
    removeSticker,
    clearStickers,
    drawStickers,
    getTrackingStatus,
    validateSnapshotTransforms,
    getDebugInfo,
  };
}
