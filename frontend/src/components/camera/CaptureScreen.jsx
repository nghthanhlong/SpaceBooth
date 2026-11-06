import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import BoothIcon from "../layout/BoothIcon";
import { STICKERS } from "../../data/stickers";
import { composePhotoStrip, STRIP_TEMPLATES } from "../../utils/photoStrip";
import "../../styles/strip-review.css";

async function loadImage(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

async function addSticker(file, sticker) {
  if (!sticker) return file;

  const url = URL.createObjectURL(file);
  try {
    const [strip, icon] = await Promise.all([
      loadImage(url),
      loadImage(sticker.src),
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = strip.naturalWidth;
    canvas.height = strip.naturalHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Không thể vẽ sticker.");
    ctx.drawImage(strip, 0, 0);

    // Đặt sticker ở góc dưới bên phải và giữ nguyên tỷ lệ.
    const margin = canvas.width * 0.025;
    const scale = canvas.width * 0.13 /
      Math.max(icon.naturalWidth, icon.naturalHeight);
    const width = icon.naturalWidth * scale;
    const height = icon.naturalHeight * scale;

    ctx.drawImage(
      icon,
      canvas.width - margin - width,
      canvas.height - margin - height,
      width,
      height,
    );

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Không thể xuất PNG."));
      }, "image/png");
    });

    return new File([blob], file.name || "spacebooth-strip.png", {
      type: "image/png",
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function CheckPhoto({ checked, number, disabled, onClick }) {
  return (
    <button
      type="button"
      className="strip-review__check"
      role="checkbox"
      aria-checked={checked}
      aria-label={`Chọn ảnh ${number}`}
      disabled={disabled}
      onClick={onClick}
      data-cv-selectable
    >
      {checked && (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 32 32">
          <path fill="currentColor" d="M3 17l6-4 5 6L27 4l2 7c-6 4-10 11-14 17z" />
        </svg>
      )}
    </button>
  );
}

export default function CaptureScreen({
  host,
  height = 480,
  photos,
  saving,
  message,
  onBack,
  onSave,
  onDiscard,
}) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState("frame");
  const [templateId, setTemplateId] = useState("film");
  const [stickerId, setStickerId] = useState(null);
  const [preview, setPreview] = useState(null);

  // Xếp ảnh theo thứ tự chụp.
  const selected = useMemo(
    () => photos.filter((photo) => selectedIds.includes(photo.id)),
    [photos, selectedIds],
  );

  const expandedIndex = photos.findIndex((photo) => photo.id === expandedId);
  const expanded = photos[expandedIndex];
  const currentPreview =
    editing &&
    preview?.selected === selected &&
    preview.templateId === templateId &&
    preview.stickerId === stickerId
      ? preview
      : null;

  useEffect(() => {
    if (!editing || selected.length === 0) return;

    let active = true;
    let url;
    const key = { selected, templateId, stickerId };

    composePhotoStrip(selected, templateId)
      .then((file) =>
        addSticker(file, STICKERS.find((item) => item.id === stickerId)),
      )
      .then((file) => {
        if (!active) return;
        url = URL.createObjectURL(file);
        setPreview({ ...key, file, url });
      })
      .catch((error) => {
        if (active) {
          setPreview({
            ...key,
            error: error?.message || "Không thể tạo dải ảnh.",
          });
        }
      });

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [editing, selected, templateId, stickerId]);

  function togglePhoto(id) {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
    );
  }

  function goBack() {
    if (saving) return;

    if (editing) {
      setPreview(null);
      setEditing(false);
    } else if (expanded) {
      setExpandedId(null);
    } else {
      onBack();
    }
  }

  function discardExpanded() {
    if (!expanded || saving) return;

    setSelectedIds((ids) => ids.filter((id) => id !== expanded.id));
    setExpandedId(null);
    onDiscard(expanded.id);
  }

  if (!host || photos.length === 0) return null;

  const backLabel = editing || expanded ? "Về chọn ảnh" : "Về camera";
  const heading = editing
    ? "Chỉnh dải ảnh"
    : expanded ? `Ảnh số ${expandedIndex + 1}` : "Chọn ảnh của bạn";

  return createPortal(
    <section className="strip-review" style={{ height }} aria-label={heading}>
      <header className="strip-review__bar">
        <div>
          <h2>{heading}</h2>
          <p aria-live="polite">
            Đã chọn {selected.length}/{photos.length} ảnh
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          aria-label={backLabel}
          title={backLabel}
          onClick={goBack}
          disabled={saving}
          data-cv-selectable
        >
          <BoothIcon direction="left" />
        </button>
      </header>

      <div className="strip-review__body">
        {editing ? (
          <div className="strip-review__editor">
            <div
              className="strip-review__templates"
              role="group"
              aria-label="Công cụ chỉnh dải ảnh"
            >
              {[
                ["frame", "Chọn khung"],
                ["sticker", "Chọn sticker"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="secondary-button"
                  aria-pressed={panel === id}
                  onClick={() => setPanel(id)}
                  disabled={saving}
                  data-cv-selectable
                >
                  {label}
                </button>
              ))}
            </div>

            {panel === "frame" ? (
              <div className="strip-review__templates" role="group" aria-label="Mẫu khung">
                {STRIP_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="secondary-button"
                    aria-pressed={templateId === template.id}
                    onClick={() => setTemplateId(template.id)}
                    disabled={saving}
                    data-cv-selectable
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="strip-review__templates" role="group" aria-label="Sticker dải ảnh">
                <button
                  type="button"
                  className="secondary-button"
                  aria-pressed={stickerId === null}
                  onClick={() => setStickerId(null)}
                  disabled={saving}
                  data-cv-selectable
                >
                  Không thêm sticker
                </button>
                {STICKERS.map((sticker) => (
                  <button
                    key={sticker.id}
                    type="button"
                    className="secondary-button"
                    aria-label={sticker.name ?? sticker.label ?? sticker.id}
                    aria-pressed={stickerId === sticker.id}
                    onClick={() => setStickerId(sticker.id)}
                    disabled={saving}
                    data-cv-selectable
                  >
                    <img
                      className="strip-review__sticker-icon"
                      src={sticker.src}
                      alt=""
                      draggable={false}
                    />
                  </button>
                ))}
              </div>
            )}

            {currentPreview?.url ? (
              <img
                className="strip-review__preview"
                src={currentPreview.url}
                alt={`Dải xem trước gồm ${selected.length} ảnh`}
              />
            ) : (
              <p role="status">{currentPreview?.error || "Đang ghép dải ảnh…"}</p>
            )}
          </div>
        ) : expanded ? (
          <div className="strip-review__expanded">
            <div className="strip-review__photo">
              <img
                src={expanded.previewUrl}
                alt={`Ảnh ${expandedIndex + 1} phóng lớn`}
              />
              <span className="strip-review__number" aria-hidden="true">
                {expandedIndex + 1}
              </span>
            </div>
            <div className="strip-review__actions strip-review__viewer-actions">
              <button
                type="button"
                className="secondary-button strip-review__viewer-arrow"
                aria-label="Ảnh trước"
                title="Ảnh trước"
                disabled={saving || photos.length < 2}
                onClick={() =>
                  setExpandedId(photos[(expandedIndex - 1 + photos.length) % photos.length].id)
                }
                data-cv-selectable
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path d="m15 5-7 7 7 7" stroke="currentColor" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              <div className="strip-review__viewer-middle">
                <CheckPhoto
                checked={selectedIds.includes(expanded.id)}
                number={expandedIndex + 1}
                disabled={saving}
                onClick={() => togglePhoto(expanded.id)}
              />
                <button
                  type="button"
                  className="secondary-button strip-review__trash"
                  aria-label="Bỏ ảnh này"
                  title="Bỏ ảnh này"
                  onClick={discardExpanded}
                  disabled={saving}
                  data-cv-selectable
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" />
                  </svg>
                </button>
              </div>

              <button
                type="button"
                className="secondary-button strip-review__viewer-arrow"
                aria-label="Ảnh tiếp theo"
                title="Ảnh tiếp theo"
                disabled={saving || photos.length < 2}
                onClick={() =>
                  setExpandedId(photos[(expandedIndex + 1) % photos.length].id)
                }
                data-cv-selectable
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          <div className="strip-review__grid">
            {photos.map((photo, index) => (
              <article key={photo.id} className="strip-review__card">
                <button
                  type="button"
                  className="strip-review__thumb strip-review__photo"
                  onClick={() => setExpandedId(photo.id)}
                  aria-label={`Xem lớn ảnh ${index + 1}`}
                  disabled={saving}
                  data-cv-selectable
                >
                  <img src={photo.previewUrl} alt="" draggable={false} />
                  <span className="strip-review__number" aria-hidden="true">
                    {index + 1}
                  </span>
                </button>
                <CheckPhoto
                  checked={selectedIds.includes(photo.id)}
                  number={index + 1}
                  disabled={saving}
                  onClick={() => togglePhoto(photo.id)}
                />
              </article>
            ))}
          </div>
        )}
      </div>

      <footer className="strip-review__bar">
        <p role="status">
          {message || (editing
            ? "Ảnh được xếp từ trên xuống theo thứ tự chụp."
            : "Chọn từ 1 đến 5 ảnh để ghép thành một dải.")}
        </p>
        {editing ? (
          <button
            type="button"
            className="primary-button strip-review__save" aria-label={saving ? "Đang lưu dải ảnh" : "Lưu dải ảnh"}
            disabled={saving || !currentPreview?.file}
            onClick={() =>
              onSave(selected.map((photo) => photo.id), currentPreview.file)
            }
            data-cv-selectable
          >
            <span className="strip-review__save-icon" aria-hidden="true">
              <svg focusable="false" viewBox="0 0 24 24">
                <path fill="currentColor" d="M6 3h12a2 2 0 0 1 2 2v15a1 1 0 0 1-1.6.8L12 16l-6.4 4.8A1 1 0 0 1 4 20V5a2 2 0 0 1 2-2z" />
              </svg>
            </span>
            <span>{saving ? "Đang lưu…" : "SAVE"}</span>
          </button>
        ) : (
          <button
            type="button"
            className="primary-button strip-review__next" aria-label="Tiếp: Chỉnh dải ảnh" title="Chỉnh dải ảnh"
            disabled={saving || selected.length === 0}
            onClick={() => {
              setExpandedId(null);
              setPanel("frame");
              setEditing(true);
            }}
            data-cv-selectable
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 48 48">
              <path fill="currentColor" d="M29 6l16 13-16 13v-9C17 23 9 30 4 42c0-17 9-27 25-28V6z" />
            </svg>
          </button>
        )}
      </footer>
    </section>,
    host,
  );
}
