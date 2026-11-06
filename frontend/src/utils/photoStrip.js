export const STRIP_TEMPLATES = [
  { id: "film", name: "Dải phim" },
  { id: "cinema", name: "Rạp chiếu" },
];

function loadPhoto(photo) {
  const image = new Image();
  image.src = photo.previewUrl;

  return image.decode().then(() => image);
}

export async function composePhotoStrip(photos, templateId = "film") {
  if (photos.length < 1 || photos.length > 5) {
    throw new Error("Hãy chọn từ 1 đến 5 ảnh.");
  }

  const images = await Promise.all(photos.map(loadPhoto));
  const isFilm = templateId === "film";

  const width = 960;
  const margin = 68;
  const photoWidth = width - margin * 2;
  const header = 144;
  const footer = 100;
  const gap = 18;

  // Giữ tỉ lệ gốc của từng ảnh, không kéo giãn hoặc cắt mặt.
  const heights = images.map((image) =>
    Math.round(photoWidth * image.naturalHeight / image.naturalWidth),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height =
    header + footer +
    heights.reduce((sum, height) => sum + height, 0) +
    gap * (images.length - 1);

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

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Không thể xuất PNG."));
        return;
      }

      resolve(new File([blob], `spacebooth-strip-${Date.now()}.png`, {
        type: "image/png",
      }));
    }, "image/png");
  });
}