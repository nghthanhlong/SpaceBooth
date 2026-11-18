export const PAPER_FRAMES = [
  {"id":"paper-usagi","label":"Usagi vàng","src":"/frames/spacebooth/strip-usagi.png","crop":[39,17,677,2039],"slots":[{"box":[84,77,586,394],"seed":[413,281]},{"box":[84,499,586,395],"seed":[361,685]},{"box":[85,922,585,407],"seed":[443,1162]},{"box":[84,1356,586,370],"seed":[337,1533]}],"extra":[1110,244,2,10,191],"cuts":[null,null,1354],"insert":3},
  {"id":"paper-pastel-music","label":"Âm nhạc pastel","src":"/frames/spacebooth/strip-pastel-music-spacebooth.png","crop":[28,27,665,1964],"slots":[{"box":[76,64,573,438],"seed":[336,306]},{"box":[68,601,581,354],"seed":[417,768]},{"box":[67,990,585,428],"seed":[361,1224]},{"box":[71,1459,578,426],"seed":[332,1678]}],"extra":[520,470,1,0,0],"cuts":[525,null,null],"insert":1,"singleFirst":true},
  {"id":"paper-shin","label":"Shin hồng","src":"/frames/spacebooth/strip-shin.png","crop":[5,6,720,2159],"slots":[{"box":[96,149,534,397],"seed":[329,347]},{"box":[96,614,534,384],"seed":[374,805]},{"box":[96,1073,534,385],"seed":[288,1265]},{"box":[96,1529,534,387],"seed":[289,1722]}],"extra":[143,472,0,0,0],"cuts":[615,null,null],"insert":1},
  {"id":"paper-family-hearts","label":"SpaceBooth hồng","src":"/frames/spacebooth/strip-family-spacebooth.png","crop":[62,36,665,1920],"slots":[{"box":[94,104,598,383],"seed":[527,269]},{"box":[94,564,599,417],"seed":[380,805]},{"box":[94,1015,599,422],"seed":[393,1260]},{"box":[94,1462,599,401],"seed":[391,1698]}],"extra":[38,525,0,0,0],"cuts":[null,null,1461],"insert":3},
  {"id":"paper-happy-day","label":"Happy Day","src":"/frames/spacebooth/strip-happy-day.png","crop":[50,58,655,1984],"slots":[{"box":[75,144,602,434],"seed":[373,394]},{"box":[67,590,608,389],"seed":[274,805]},{"box":[75,1023,600,382],"seed":[270,1214]},{"box":[73,1482,599,415],"seed":[444,1691]}],"extra":[58,531,0,0,0],"cuts":[null,null,1480],"insert":3},
];

const bandCache = new WeakMap();

function canvas2d(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Không thể tạo dải ảnh.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return [canvas, ctx];
}

function prepareBands(image, config) {
  if (bandCache.has(image)) return bandCache.get(image);
  const [x, y, width, height] = config.crop;
  const cuts = [y];
  for (let i = 0; i < 3; i++) {
    const [a, b] = [config.slots[i].box, config.slots[i + 1].box];
    cuts.push(Math.floor((a[1] + a[3] + b[1]) / 2));
  }
  cuts.push(y + height);
  config.cuts.forEach((cut, i) => { if (cut !== null) cuts[i + 1] = cut; });
  const rows = config.slots.map((slot, i) => {
    const sy = cuts[i], sh = cuts[i + 1] - sy;
    const [mask, ctx] = canvas2d(width, sh);
    ctx.drawImage(image, x, sy, width, sh, 0, 0, width, sh);
    const rgba = ctx.getImageData(0, 0, width, sh);
    const visited = new Uint8Array(width * sh);
    const queue = new Uint32Array(width * sh);
    let head = 0, tail = 0;
    const visit = (p) => {
      if (visited[p] || rgba.data[p * 4 + 3] >= 128) return;
      visited[p] = 1;
      queue[tail++] = p;
    };
    visit((slot.seed[1] - sy) * width + slot.seed[0] - x);
    while (head < tail) {
      const p = queue[head++], px = p % width;
      if (px > 0) visit(p - 1);
      if (px + 1 < width) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p + width < visited.length) visit(p + width);
    }
    if (!tail) throw new Error(`Không tìm thấy ô ảnh: ${config.label}`);
    const pixels = ctx.createImageData(width, sh);
    for (let j = 0; j < tail; j++) pixels.data[queue[j] * 4 + 3] = 255;
    ctx.clearRect(0, 0, width, sh);
    ctx.putImageData(pixels, 0, 0);
    return { sy, sh, mask, box: slot.box };
  });
  bandCache.set(image, rows);
  return rows;
}

function cover(ctx, image, x, y, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

function extraBand(frame, config, rows) {
  if (rows.extra) return rows.extra;
  const [sy, sh, index, seam, extension] = config.extra;
  const [x, , width] = config.crop;
  const [art, artCtx] = canvas2d(width, sh + extension);
  const [mask, maskCtx] = canvas2d(width, sh + extension);
  const copy = (ctx, image, offsetX, offsetY) => {
    if (!extension) {
      ctx.drawImage(image, offsetX, offsetY, width, sh, 0, 0, width, sh);
      return;
    }
    ctx.drawImage(image, offsetX, offsetY, width, seam, 0, 0, width, seam);
    ctx.drawImage(image, offsetX, offsetY + seam, width, 1, 0, seam, width, extension + 1);
    ctx.drawImage(image, offsetX, offsetY + seam + 1, width, sh - seam - 1,
      0, seam + extension + 1, width, sh - seam - 1);
  };
  copy(artCtx, frame, x, sy);
  copy(maskCtx, rows[index].mask, 0, sy - rows[index].sy);
  const [left, top, w, h] = rows[index].box;
  const photoTop = Math.max(top, sy);
  const photoEnd = Math.min(top + h, sy + sh);
  rows.extra = {
    sy: 0, sh: sh + extension, art, mask,
    box: [left, photoTop - sy, w, photoEnd - photoTop + extension],
  };
  return rows.extra;
}

export function renderPaperStrip(images, frame, config, renderScale) {
  const [x, cropY, width, height] = config.crop;
  const scale = 1600 / width * renderScale;
  const rows = prepareBands(frame, config);
  const count = images.length;
  const indices = count === 1 ? [config.singleFirst ? 0 : 3]
    : Array.from({ length: Math.min(count, 4) }, (_, i) => i);
  if (count === 5) indices.splice(config.insert, 0, -1);
  const pieces = [];
  let cursor = 0;
  if (count === 1 && !config.singleFirst) {
    const header = config.slots[0].box[1] - cropY;
    cursor = Math.max(0, header - (rows[3].box[1] - rows[3].sy)) * scale;
  }
  indices.forEach((index, i) => {
    const row = index === -1 ? extraBand(frame, config, rows) : rows[index];
    const [left, top, w, h] = row.box;
    const trim = count < 4 && (count > 1 || config.singleFirst) && i === count - 1;
    const rowHeight = trim ? top + h - row.sy : row.sh;
    const [layer, ctx] = canvas2d(width * scale, rowHeight * scale);
    cover(ctx, images[i], (left - x) * scale, (top - row.sy) * scale, w * scale, h * scale);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(row.mask, 0, 0, width * scale, row.sh * scale);
    ctx.globalCompositeOperation = "source-over";
    if (row.art) ctx.drawImage(row.art, 0, 0, width, rowHeight, 0, 0, width * scale, rowHeight * scale);
    else ctx.drawImage(frame, x, row.sy, width, rowHeight, 0, 0, width * scale, rowHeight * scale);
    pieces.push({ layer, y: Math.round(cursor), row });
    cursor += layer.height;
  });
  const last = pieces[pieces.length - 1];
  const lastBox = config.slots[3].box;
  if (count < 4 && (count > 1 || config.singleFirst)) cursor += (cropY + height - lastBox[1] - lastBox[3]) * scale;
  const [canvas, ctx] = canvas2d(width * scale, cursor);
  for (const piece of pieces) ctx.drawImage(piece.layer, 0, piece.y);
  if (count < 4 && (count > 1 || config.singleFirst)) {
    const start = lastBox[1] + Math.floor(lastBox[3] * 0.3);
    const photoEnd = last.y + (last.row.box[1] + last.row.box[3] - last.row.sy) * scale;
    const dy = photoEnd - (lastBox[1] + lastBox[3] - start) * scale;
    ctx.drawImage(frame, x, start, width, cropY + height - start,
      0, dy, width * scale, (cropY + height - start) * scale);
  }
  if (count === 1 && !config.singleFirst) {
    const top = config.slots[0].box;
    const headerEnd = top[1] + Math.floor(top[3] * 0.5);
    ctx.drawImage(frame, x, cropY, width, headerEnd - cropY,
      0, 0, width * scale, (headerEnd - cropY) * scale);
  }
  return canvas;
}

export function renderPlainStrip(images, renderScale) {
  const width = 1600, margin = 26, gap = 26, photoWidth = width - margin * 2;
  const heights = images.map((im) => Math.round(photoWidth * im.naturalHeight / im.naturalWidth));
  const height = margin * 2 + heights.reduce((a, b) => a + b, 0) + gap * (images.length - 1);
  const [canvas, ctx] = canvas2d(width * renderScale, height * renderScale);
  ctx.scale(renderScale, renderScale);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  let y = margin;
  images.forEach((im, i) => {
    ctx.drawImage(im, margin, y, photoWidth, heights[i]);
    y += heights[i] + gap;
  });
  return canvas;
}

export const PLAIN_THUMBNAIL = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="76"><rect x="2" y="2" width="52" height="72" rx="2" fill="white" stroke="#cbd5e1"/><rect x="8" y="12" width="40" height="52" fill="#e2e8f0"/></svg>'
);
