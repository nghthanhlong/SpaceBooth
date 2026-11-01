import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BoothIcon from "../layout/BoothIcon";
import "../../styles/photo-review.css";
import "../../styles/booth-icons.css";

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

function createSlots(count) {
  const slots = [];
  let remaining = {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  };

  for (let index = 0; index < count; index += 1) {
    if (index === count - 1) {
      slots.push({ ...remaining });
      break;
    }

    const fraction = 1 / GOLDEN_RATIO;
    const direction = index % 4;
    const slot = { ...remaining };

    if (direction === 0) {
      slot.width = remaining.width * fraction;
      remaining = {
        ...remaining,
        left: remaining.left + slot.width,
        width: remaining.width - slot.width,
      };
    } else if (direction === 1) {
      slot.height = remaining.height * fraction;
      remaining = {
        ...remaining,
        top: remaining.top + slot.height,
        height: remaining.height - slot.height,
      };
    } else if (direction === 2) {
      slot.width = remaining.width * fraction;
      slot.left = remaining.left + remaining.width - slot.width;
      remaining = {
        ...remaining,
        width: remaining.width - slot.width,
      };
    } else {
      slot.height = remaining.height * fraction;
      slot.top = remaining.top + remaining.height - slot.height;
      remaining = {
        ...remaining,
        height: remaining.height - slot.height,
      };
    }

    slots.push(slot);
  }

  return slots;
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
  const [firstIndex, setFirstIndex] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [leavingId, setLeavingId] = useState(null);
  const [moving, setMoving] = useState(false);
  const [boardSize, setBoardSize] = useState(null);

  const timerRef = useRef(null);
  const viewportRef = useRef(null);

  const count = photos.length;
  const first = count > 0 ? firstIndex % count : 0;
  const slots = createSlots(count);

  const expandedPhoto =
    photos.find((photo) => photo.id === expandedId) ?? null;

  const currentPhoto = expandedPhoto ?? photos[first];
  const currentNumber = currentPhoto
    ? photos.findIndex((photo) => photo.id === currentPhoto.id) + 1
    : 0;

  const backLabel = expandedPhoto
    ? "Về chọn ảnh"
    : "Về camera";

  useEffect(() => {
    return () => window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function measure() {
      const width = Math.min(
        viewport.clientWidth,
        viewport.clientHeight * GOLDEN_RATIO,
      );

      setBoardSize({
        width,
        height: width / GOLDEN_RATIO,
      });
    }

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [host]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving && !moving) {
        setExpandedId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [saving, moving]);

  function handleBack() {
    if (saving || moving) return;

    if (expandedPhoto) {
      setExpandedId(null);
    } else {
      onBack();
    }
  }

  function moveNext() {
    if (saving || moving || count < 2) return;

    // Đang xem lớn: tiếp tục xem lớn ảnh tiếp theo.
    if (expandedPhoto) {
      const nextIndex = currentNumber % count;
      setFirstIndex(nextIndex);
      setExpandedId(photos[nextIndex].id);
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    window.clearTimeout(timerRef.current);
    setLeavingId(null);

    // Đổi vị trí ngay để CSS chuyển động cả vị trí và kích thước.
    setFirstIndex((previous) => (previous + 1) % count);

    if (reducedMotion) return;

    setMoving(true);

    timerRef.current = window.setTimeout(() => {
      setMoving(false);
    }, 600);
  }
  function discardCurrent() {
    if (!currentPhoto || saving || moving) return;

    setExpandedId(null);
    setFirstIndex(0);
    onDiscard(currentPhoto.id);
  }

  function saveCurrent() {
    if (!currentPhoto || saving || moving) return;

    onSave([currentPhoto.id]);
  }

  if (!host || count === 0) return null;

  return createPortal(
    <section
      className="capture-screen photo-review"
      style={{ height }}
      aria-label="Chọn ảnh vừa chụp"
    >
      <header className="review-heading">
        <div>
          <h2>
            {expandedPhoto ? "Xem ảnh của bạn" : "Chọn ảnh của bạn"}
          </h2>
          <p>
            {count} ảnh chưa lưu · Đang xem ảnh {currentNumber}
          </p>
        </div>

        <button
          type="button"
          className="review-back-button"
          onClick={handleBack}
          disabled={saving || moving}
          aria-label={backLabel}
          title={backLabel}
          data-cv-selectable
        >
          <BoothIcon direction="left" />
        </button>
      </header>

      <div className="review-viewport" ref={viewportRef}>
        <div
          className="review-board"
          style={
            boardSize
              ? {
                  width: boardSize.width,
                  height: boardSize.height,
                }
              : undefined
          }
        >
          {expandedPhoto ? (
            <div className="review-expanded">
              <img
                src={expandedPhoto.previewUrl}
                alt={`Ảnh ${currentNumber} phóng lớn`}
              />
            </div>
          ) : (
            photos.map((photo, index) => {
              const position = (index - first + count) % count;
              const slot = slots[position];

              return (
                <button
                  key={photo.id}
                  type="button"
                  className={[
                    "review-photo",
                    leavingId === photo.id
                      ? "review-photo--leaving"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    left: `${slot.left}%`,
                    top: `${slot.top}%`,
                    width: `${slot.width}%`,
                    height: `${slot.height}%`,
                  }}
                  onClick={() => setExpandedId(photo.id)}
                  disabled={saving || moving}
                  aria-label={`Phóng lớn ảnh ${index + 1}`}
                  data-cv-selectable
                >
                  <span className="review-photo-surface">
                    <img
                      src={photo.previewUrl}
                      alt={`Ảnh vừa chụp ${index + 1}`}
                      draggable="false"
                    />

                    <span className="review-photo-number">
                      {index + 1}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <p
        className="review-message"
        role="status"
        data-has-message={Boolean(message)}
      >
        {message ||
          (expandedPhoto
            ? "Bấm quay về để chọn ảnh khác; bấm xoay vòng để xem ảnh tiếp theo."
            : "Bấm ảnh để xem lớn · × bỏ ảnh · ✓ lưu ảnh đang xem")}
      </p>

      <footer className="review-footer">
        <div className="review-navigation">
          <button
            type="button"
            className="review-arrow-button review-cycle-button"
            onClick={moveNext}
            disabled={saving || moving || count < 2}
            aria-label="Xoay vòng sang ảnh tiếp theo"
            title="Ảnh tiếp theo"
            data-cv-selectable
          >
            <BoothIcon kind="cycle" />
          </button>

          <span className="review-position">
            {currentNumber}/{count}
          </span>
        </div>

        <div className="review-decisions">
          <button
            type="button"
            className="review-decision review-decision--discard"
            onClick={discardCurrent}
            disabled={saving || moving}
            aria-label={`Bỏ ảnh ${currentNumber}`}
            title="Bỏ ảnh đang xem"
            data-cv-selectable
          >
            ×
          </button>

          <button
            type="button"
            className="review-decision review-decision--save"
            onClick={saveCurrent}
            disabled={saving || moving}
            aria-label={`Lưu ảnh ${currentNumber}`}
            title="Lưu ảnh đang xem"
            data-cv-selectable
          >
            {saving ? "…" : "✓"}
          </button>
        </div>
      </footer>
    </section>,
    host,
  );
}