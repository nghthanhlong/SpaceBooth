import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_TRACKING_CONFIG,
  FACE,
  STICKER_SLOTS,
  StickerPoseFilter,
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
  const poseFiltersRef = useRef(new Map());
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

    const replaced = placementsRef.current.filter(
      (previous) =>
        previous.faceId === target.face.id &&
        STICKER_SLOTS[previous.kind] === STICKER_SLOTS[kind],
    );
    targetRef.current = null;
    if (replaced.length === 1 && replaced[0].kind === kind) {
      return "unchanged";
    }

    for (const previous of replaced) {
      preservedTransformsRef.current.delete(previous.id);
      poseFiltersRef.current.delete(previous.id);

    }

    const item = {
      id: `${target.face.id}:${kind}`,
      faceId: target.face.id,
      kind,
    };

    const next = [
      ...placementsRef.current.filter((previous) => !replaced.includes(previous)),
      item,
    ];

    placementsRef.current = next;
    setPlacements(next);

    // Trigger snapping animation effect
    snapAnimationRef.current = {
      faceId: target.face.id,
      kind,
      startTime: performance.now(),
      duration: 400,
    };

    return replaced.length > 0 ? "replaced" : "added";
  }, []);

  const autoSnapSticker = useCallback(
    (kind, faces, targetFaceId = null, cameraStage = null) => {
      if (!faces || faces.length === 0) {
        return { success: false, reason: "no_face" };
      }

      let size = { width: 1280, height: 720 };
      if (cameraStage) {
        const canvas = cameraStage.querySelector(".camera-layer");
        if (canvas?.width > 0 && canvas?.height > 0) {
          size = { width: canvas.width, height: canvas.height };
        }
      }
      const active = faces.filter(face => !face.stale);
      const face = targetFaceId == null
        ? (active.length === 1 ? active[0] : null)
        : active.find(face => face.id === targetFaceId);
      const snapTarget = face ? { face, placement: placeSticker(face, kind, size) } : null;
      if (!snapTarget) {
        return { success: false, reason: "no_reliable_face" };
      }

      const committed = commitTarget(snapTarget, kind);
      return {
        success: Boolean(committed),
        action: committed,
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
    poseFiltersRef.current.delete(id);

  }, []);

  const clearStickers = useCallback(() => {
    placementsRef.current = [];
    targetRef.current = null;
    preservedTransformsRef.current.clear();
    poseFiltersRef.current.clear();

    snapAnimationRef.current = null;
    setPlacements([]);
  }, []);

  /**
   * Main sticker rendering loop with robust fallback & tracking state machine:
   * 1. TRACKING: Live face detected -> compute pose, smooth, update preserved transform.
   * 2. TEMPORARY_HOLD: Face missing briefly -> render with preserved transform.
   * 3. Face returns with the same ID -> reset filtering and attach immediately.
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
      const attachedFaces = placementsRef.current.length > 0
        ? activeFaces.filter(face => placementsRef.current.some(item => item.faceId === face.id))
        : activeFaces;
      if (attachedFaces.length > 0) {
        lastValidFaceTimestampRef.current = Math.max(...attachedFaces.map(face => face.lastSeen ?? now));
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

      const retained = placementsRef.current.filter(item => faces.some(face => face.id === item.faceId));
      if (retained.length !== placementsRef.current.length) {
        for (const item of placementsRef.current) {
          if (retained.includes(item)) continue;
          preservedTransformsRef.current.delete(item.id);
          poseFiltersRef.current.delete(item.id);

        }
        placementsRef.current = retained;
        setPlacements(retained);
      }

      for (const item of placementsRef.current) {
        const image = imagesRef.current.get(item.kind);
        if (!image) continue;

        const face = faces.find((candidate) => candidate.id === item.faceId);
        // Never transfer a sticker to a new track based on proximity.
        if (!face) continue;

        const observedAt = face.lastSeen ?? now;
        const isFaceActive = !face.stale && face.landmarks?.length > 0 &&
          now - observedAt <= config.shortInterruptionMs;

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

          let filter = poseFiltersRef.current.get(poseKey);
          if (!filter) {
            filter = new StickerPoseFilter();
            poseFiltersRef.current.set(poseKey, filter);
          }
          // Snapshots use measured anchors, without live smoothing or pop effects.
          const finalPose = isSnapshot ? rawPose : filter.update(rawPose, observedAt, size);
          const currentState = "TRACKING";

          // Update preserved transform
          preservedTransformsRef.current.set(poseKey, {
            faceId: item.faceId,
            stickerId: item.id,
            kind: item.kind,
            x: finalPose.x,
            y: finalPose.y,
            width: finalPose.width,
            angle: finalPose.angle,
            lastValidTime: observedAt,
            trackingState: currentState,
            faceCenter: nosePx,
            eyeDistance,
          });

          // Check snapping pop animation
          let extraScale = 1;
          if (
            !isSnapshot &&
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
        } else {
          // Reacquisition should attach immediately instead of trailing behind
          // the moving face through a second recovery animation.
          poseFiltersRef.current.get(poseKey)?.reset();
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

            // Brief holds mask detector flicker. Longer freezes leave a sticker
            // floating at the old location after the user has moved away.
            const maxHoldMs = isSnapshot
              ? Math.min(config.maxSnapshotTransformAgeMs, config.shortInterruptionMs)
              : config.shortInterruptionMs;
            const canRenderFallback = elapsedSinceValid <= maxHoldMs;

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
        (t) => isTransformFinite(t) && now - t.lastValidTime <= Math.min(config.maxSnapshotTransformAgeMs, config.shortInterruptionMs),
      ).length,
      message,
    };
  }, []);

  /**
   * Pre-snapshot validation:
   * Ensures that every placed sticker has a valid, safe transform before taking the photo.
   */
  const validateSnapshotTransforms = useCallback((faces = null) => {
    const config = configRef.current;
    const now = performance.now();
    const items = placementsRef.current;

    if (items.length === 0) {
      return { valid: true, transforms: [] };
    }

    const validTransforms = [];
    for (const item of items) {
      if (faces && !faces.some(face => face.id === item.faceId)) continue;
      const transform = preservedTransformsRef.current.get(item.id);
      if (!transform || !isTransformFinite(transform)) {
        return {
          valid: false,
          reason: `Sticker ${item.kind} chưa có vị trí hợp lệ.`,
          transforms: [],
        };
      }

      const age = now - transform.lastValidTime;
      if (age > Math.min(config.maxSnapshotTransformAgeMs, config.shortInterruptionMs)) {
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
      valid: isTransformFinite(t) && now - t.lastValidTime <= Math.min(configRef.current.maxSnapshotTransformAgeMs, configRef.current.shortInterruptionMs),
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
