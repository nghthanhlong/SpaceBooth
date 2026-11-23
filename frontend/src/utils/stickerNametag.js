export function drawStickerNametag(ctx, size, box) {
  const label = "Đến lượt bạn chọn sticker!";
  const unit = 0.75 * Math.min(size.width / 640, size.height / 360);
  if (!(unit > 0)) return;

  ctx.save();
  ctx.scale(unit, unit);
  const width = size.width / unit;
  const height = size.height / unit;
  ctx.font = '800 15px system-ui, sans-serif';
  const tagWidth = ctx.measureText(label).width + 44;
  const headX = (box.left + box.right) * width / 2;
  const left = Math.max(4, Math.min(headX - tagWidth / 2, width - tagWidth - 4));
  const top = Math.max(4, Math.min(box.top * height - 44, height - 44));
  const tip = Math.max(13, Math.min(headX - left, tagWidth - 13));
  ctx.translate(left, top);

  ctx.lineJoin = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#553458";
  ctx.fillStyle = "#fff0f6";
  ctx.beginPath();
  ctx.roundRect(0, 0, tagWidth, 30, 15);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip - 6, 29);
  ctx.lineTo(tip, 36);
  ctx.lineTo(tip + 6, 29);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.strokeText(label, tagWidth / 2, 15);
  ctx.fillStyle = "#653053";
  ctx.fillText(label, tagWidth / 2, 15);
  ctx.fillStyle = "#bf647d";
  ctx.fillText("✦", 12, 15);
  ctx.fillText("✦", tagWidth - 12, 15);
  ctx.restore();
}
