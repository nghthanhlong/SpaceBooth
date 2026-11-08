import { STICKERS } from "../../data/stickers";

export default function StickerPicker({
  ready,
  error,
  placements,
  activeKind,
  selectedKind,
  onPick,
  onRemove,
  onClear,
}) {
  return (
    <>
      <h2>Chọn sticker</h2>

      <p className="muted-text">
        Chỉ ngón trỏ vào sticker và giữ yên 0.7s để tự động gắn lên mặt.
      </p>

      {error && <p role="alert">{error}</p>}

      <div className="sticker-grid" data-cv-selectable>
        {STICKERS.map((sticker) => {
          const isTargeted = activeKind === sticker.id;
          const isSelected = selectedKind === sticker.id;

          return (
            <button
              key={sticker.id}
              type="button"
              className={`sticker-option ${isTargeted ? "is-dwelling" : ""} ${
                isSelected ? "is-selected" : ""
              }`}
              data-sticker-kind={sticker.id}
              disabled={!ready}
              onClick={() => onPick(sticker.id)}
            >
              <div className="sticker-preview-wrapper">
                <img src={sticker.src} alt="" />
                <svg
                  className="dwell-progress-ring"
                  viewBox="0 0 100 100"
                  aria-hidden="true"
                >
                  <circle className="dwell-ring-bg" cx="50" cy="50" r="44" />
                  <circle
                    className="dwell-ring-fill"
                    cx="50"
                    cy="50"
                    r="44"
                  />
                </svg>
                {isSelected && (
                  <div className="dwell-snap-badge" aria-hidden="true">
                    ✓
                  </div>
                )}
              </div>
              <span>{sticker.name}</span>
            </button>
          );
        })}
      </div>

      {!ready && !error && (
        <p className="muted-text">Đang tải sticker…</p>
      )}

      <div className="placed-stickers">
        <h3>Đã dán: {placements.length}</h3>

        {placements.length === 0 && (
          <p className="muted-text">
            Chưa có sticker trên khuôn mặt.
          </p>
        )}

        <div data-cv-selectable>
          {placements.map((item) => {
            const name =
              STICKERS.find((sticker) => sticker.id === item.kind)?.name ??
              item.kind;

            return (
              <div className="placed-sticker-row" key={item.id}>
                <span>
                  {name} · Mặt #{item.faceId}
                </span>

                <button
                  type="button"
                  className="remove-sticker-button"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Xóa ${name} khỏi mặt ${item.faceId}`}
                  title={`Xóa ${name}`}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            );
          })}

          <button
            type="button"
            className="clear-stickers-button"
            onClick={onClear}
            disabled={placements.length === 0}
          >
            Xóa tất cả
          </button>
        </div>
      </div>
    </>
  );
}
