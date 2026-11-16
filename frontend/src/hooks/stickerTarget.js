export function confirmedStickerFace(data, now) {
  const target = data?.controllerTarget;
  if (data?.controller?.kind !== "locked" || target?.status !== "confirmed" ||
      target.handId !== data.controller.handId || !Number.isFinite(target.observedAt) ||
      now - target.observedAt > 350 || now < target.observedAt) return null;
  return data.faces.find(face => face.id === target.faceId && !face.stale)?.id ?? null;
}

export function faceBounds(face) {
  const xs = face.landmarks.map(p => p.x);
  const ys = face.landmarks.map(p => p.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

export function faceAtPoint(faces, point) {
  const candidates = faces.filter(face => {
    if (face.stale) return false;
    const box = faceBounds(face);
    return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
  });
  return candidates.length === 1 ? candidates[0].id : null;
}
