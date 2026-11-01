import { useCallback, useEffect, useRef, useState } from "react";
import { findSnapTarget, placeSticker } from "spacebooth-cv";
import { STICKERS } from "../data/stickers";

export default function useStickers() {
  const imagesRef = useRef(new Map());
  const placementsRef = useRef([]);
  const targetRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [placements, setPlacements] = useState([]);

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

    // Mặt đang bị mất dấu không được nhận sticker mới.
    const faces = data.faces.filter((face) => !face.stale);
    const target = findSnapTarget(drop, faces, kind, size);

    targetRef.current = target
      ? { faceId: target.face.id, kind }
      : null;

    return target;
  }, []);

  const commitTarget = useCallback((target, kind) => {
    if (!target) return false;

    // Một loại sticker trên một mặt: chọn lại thì thay thế.
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

    return true;
  }, []);

  const removeSticker = useCallback((id) => {
    const next = placementsRef.current.filter((item) => item.id !== id);
    placementsRef.current = next;
    setPlacements(next);
  }, []);

  const clearStickers = useCallback(() => {
    placementsRef.current = [];
    targetRef.current = null;
    setPlacements([]);
  }, []);

  const drawStickers = useCallback((ctx, size, faces, preview = false) => {
    function drawOne(face, kind, opacity = 1) {
      const image = imagesRef.current.get(kind);
      if (!image) return;

      const pose = placeSticker(face, kind, size);

      if (
        !Number.isFinite(pose.x) ||
        !Number.isFinite(pose.y) ||
        !Number.isFinite(pose.width) ||
        !Number.isFinite(pose.angle) ||
        pose.width <= 0
      ) {
        return;
      }

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
      const face = faces.find((candidate) => candidate.id === item.faceId);

      // Không tìm được mặt thì tạm ẩn, không dán sang người khác.
      if (face) drawOne(face, item.kind);
    }

    if (preview && targetRef.current) {
      const target = targetRef.current;
      const face = faces.find(
        (candidate) => candidate.id === target.faceId && !candidate.stale,
      );

      if (face) {
        drawOne(face, target.kind, 0.55);

        const xs = face.landmarks.map((point) => point.x * size.width);
        const ys = face.landmarks.map((point) => point.y * size.height);

        const left = Math.min(...xs);
        const top = Math.min(...ys);
        const width = Math.max(...xs) - left;
        const height = Math.max(...ys) - top;

        ctx.save();
        ctx.strokeStyle = "#4ade80";
        ctx.lineWidth = 4;
        ctx.strokeRect(left, top, width, height);
        ctx.restore();
      }
    }
  }, []);

  return {
    ready,
    assetError,
    placements,
    findTarget,
    commitTarget,
    clearTarget,
    removeSticker,
    clearStickers,
    drawStickers,
  };
}