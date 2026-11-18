import { createElement } from "react";
import { FRAME_CATALOG } from "./frameCatalog";

function frameThumbnail(src, label) {
  return createElement("img", {
    src,
    alt: label,
    title: label,
    draggable: false,
    loading: "lazy",
    decoding: "async",
    style: { width: 76, height: 76, objectFit: "contain", display: "block" },
  });
}

function stripThumbnail(film) {
  const background = film ? "#171717" : "#fff0ad";
  const accent = film ? "#fff" : "#efba43";
  const holes = film
    ? Array.from({ length: 8 }, (_, i) => {
        const y = 18 + i * 6;
        return `<rect x="4" y="${y}" width="3" height="3"/><rect x="41" y="${y}" width="3" height="3"/>`;
      }).join("")
    : '<path d="M3 4h42M3 68h42" stroke="#efba43" stroke-width="1"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="72" viewBox="0 0 48 72"><rect width="48" height="72" rx="2" fill="${background}"/><g fill="${accent}">${holes}</g><rect x="10" y="18" width="28" height="45" fill="#94a3b8"/><path d="M15 9h18M19 12h10" stroke="${film ? '#fff' : '#593b12'}" stroke-width="1.3"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const STRIP_TEMPLATES = [
  { id: "film", name: frameThumbnail(stripThumbnail(true), "Khung Dải phim") },
  { id: "cinema", name: frameThumbnail(stripThumbnail(false), "Khung Rạp chiếu") },
  ...FRAME_CATALOG.map((frame) => ({
    id: frame.id, name: frameThumbnail(frame.src, `Khung ${frame.label}`),
  })),
];

async function loadImage(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

const frameCache = new Map();
function loadFrame(src) {
  if (!frameCache.has(src)) {
    frameCache.set(src, loadImage(src).catch((error) => {
      frameCache.delete(src);
      throw error;
    }));
  }
  return frameCache.get(src);
}

function exportPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Không thể xuất PNG."));
      resolve(new File([blob], `spacebooth-strip-${Date.now()}.png`, {
        type: "image/png",
      }));
    }, "image/png");
  });
}

// Giữ tỷ lệ họa tiết; nối hàng/cột ở những đoạn viền ít chi tiết.
function extendEdge(ctx, image, source, target, scale, vertical, seam = 0.5) {
  const [sx, sy, sw, sh] = source;
  const [dx, dy, dw, dh] = target;
  const length = vertical ? sh : sw;
  const centered = Array.isArray(seam);
  const split = Math.max(1, Math.min(length - 2,
    Math.floor(length * (centered ? seam[0] : seam))));
  const before = split * scale;
  const after = (length - split - 1) * scale;
  const extra = (vertical ? dh : dw) - before - after;
  if (extra < 0) throw new Error("Kích thước khung không hợp lệ.");
  if (centered) {
    const second = Math.min(length - 2, Math.floor(length * seam[1]));
    const middle = second - split - 1;
    const full = vertical ? dh : dw;
    const middleAt = (full - length * scale) / 2 + (split + 1) * scale;
    const lastAt = full - (length - second - 1) * scale;
    const patch = (start, size, dest, output) => {
      if (size <= 0 || output <= 0) return;
      if (vertical) ctx.drawImage(image, sx, sy + start, sw, size,
        dx, dy + dest, dw, output);
      else ctx.drawImage(image, sx + start, sy, size, sh,
        dx + dest, dy, output, dh);
    };
    patch(0, split, 0, split * scale);
    patch(split, 1, split * scale, middleAt - split * scale);
    patch(split + 1, middle, middleAt, middle * scale);
    patch(second, 1, middleAt + middle * scale,
      lastAt - middleAt - middle * scale);
    patch(second + 1, length - second - 1, lastAt, full - lastAt);
    return;
  }
  if (vertical) {
    ctx.drawImage(image, sx, sy, sw, split, dx, dy, dw, before);
    ctx.drawImage(image, sx, sy + split, sw, 1, dx, dy + before, dw, extra);
    ctx.drawImage(image, sx, sy + split + 1, sw, sh - split - 1,
      dx, dy + dh - after, dw, after);
  } else {
    ctx.drawImage(image, sx, sy, split, sh, dx, dy, before, dh);
    ctx.drawImage(image, sx + split, sy, 1, sh, dx + before, dy, extra, dh);
    ctx.drawImage(image, sx + split + 1, sy, sw - split - 1, sh,
      dx + dw - after, dy, after, dh);
  }
}

function drawFrame(ctx, image, width, height, config) {
  const [x, y, w, h] = config.crop;
  const [cx, cy] = config.cut;
  const scale = config.scale;
  const cw = cx * scale, ch = cy * scale;
  const mw = width - cw * 2, mh = height - ch * 2;
  const draw = (sx, sy, dx, dy) =>
    ctx.drawImage(image, sx, sy, cx, cy, dx, dy, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  draw(x, y, 0, 0);
  draw(x + w - cx, y, width - cw, 0);
  draw(x, y + h - cy, 0, height - ch);
  draw(x + w - cx, y + h - cy, width - cw, height - ch);
  const seams = config.seams;
  extendEdge(ctx, image, [x + cx, y, w - cx * 2, cy],
    [cw, 0, mw, ch], scale, false, seams[0]);
  extendEdge(ctx, image, [x + cx, y + h - cy, w - cx * 2, cy],
    [cw, height - ch, mw, ch], scale, false, seams[1]);
  extendEdge(ctx, image, [x, y + cy, cx, h - cy * 2],
    [0, ch, cw, mh], scale, true, seams[2]);
  extendEdge(ctx, image, [x + w - cx, y + cy, cx, h - cy * 2],
    [width - cw, ch, cw, mh], scale, true, seams[3]);
  // Giữ phần mái đình nhô vào giữa của mẫu Hương Việt.
  for (const [sx, sy, sw, sh] of config.patches) {
    ctx.drawImage(image, sx, sy, sw, sh,
      width - (x + w - sx) * scale,
      height - (y + h - sy) * scale, sw * scale, sh * scale);
  }
}

async function composeDecorated(images, config) {
  const frame = await loadFrame(config.src);
  const canvas = document.createElement("canvas");
  const width = 1600;
  const margin = 26;
  const top = 26;
  const bottom = 26;
  const gap = 16;
  const photoWidth = width - margin * 2;
  const heights = images.map((image) =>
    Math.round(photoWidth * image.naturalHeight / image.naturalWidth));
  const contentHeight = heights.reduce((sum, h) => sum + h, 0)
    + gap * (images.length - 1);
  canvas.width = width;
  canvas.height = top + contentHeight + bottom;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Không thể tạo dải ảnh.");
  ctx.fillStyle = config.color;

  let y = top + (canvas.height - top - bottom - contentHeight) / 2;
  images.forEach((image, index) => {
    ctx.drawImage(image, margin, y, photoWidth, heights[index]);
    y += heights[index];
    if (index < images.length - 1) {
      ctx.fillRect(margin, y, photoWidth, gap);
      y += gap;
    }
  });
  drawFrame(ctx, frame, width, canvas.height, config);
  return exportPng(canvas);
}

export async function composePhotoStrip(photos, templateId = "film") {
  if (photos.length < 1 || photos.length > 5) {
    throw new Error("Hãy chọn từ 1 đến 5 ảnh.");
  }
  const images = await Promise.all(photos.map((photo) => loadImage(photo.previewUrl)));
  const config = FRAME_CATALOG.find((frame) => frame.id === templateId);
  if (config) return composeDecorated(images, config);
  if (!["film", "cinema"].includes(templateId)) {
    throw new Error("Mẫu khung không tồn tại.");
  }
  const isFilm = templateId === "film";
  const width = 960, margin = 68, header = 144, footer = 100, gap = 18;
  const photoWidth = width - margin * 2;
  const heights = images.map((image) =>
    Math.round(photoWidth * image.naturalHeight / image.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = header + footer + heights.reduce((sum, h) => sum + h, 0)
    + gap * (images.length - 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Không thể tạo dải ảnh.");
  ctx.fillStyle = isFilm ? "#171717" : "#fff0ad";
  ctx.fillRect(0, 0, width, canvas.height);
  if (isFilm) {
    ctx.fillStyle = "#fff";
    for (let y = header; y + 22 <= canvas.height - footer; y += 40) {
      ctx.fillRect(19, y, 27, 22);
      ctx.fillRect(width - 46, y, 27, 22);
    }
  } else {
    ctx.fillStyle = "#efba43";
    ctx.fillRect(22, 22, width - 44, 5);
    ctx.fillRect(22, canvas.height - 27, width - 44, 5);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isFilm ? "#fff" : "#593b12";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText("SPACEBOOTH", width / 2, 64);
  ctx.font = "24px sans-serif";
  ctx.fillText(isFilm ? "PHOTO STRIP" : "MOVIE NIGHT", width / 2, 108);
  let y = header;
  images.forEach((image, index) => {
    ctx.drawImage(image, margin, y, photoWidth, heights[index]);
    y += heights[index] + gap;
  });
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(`${images.length} khoảnh khắc`, width / 2, canvas.height - 50);
  return exportPng(canvas);
}
