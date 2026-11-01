import { STICKERS } from "../../data/stickers";

export default function StickerPicker({
  ready,
  error,
  placements,
  onPick,
  onRemove,
  onClear,
}) {
  return (
    <>
      <h2>Chọn sticker</h2>

      <p className="muted-text">
        Chụm ngón cái và ngón trỏ để gắp.
        Giữ để kéo, tách hai ngón để thả.
      </p>

      {error && <p role="alert">{error}</p>}

      <div className="sticker-grid" data-cv-selectable>
        {STICKERS.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            className="sticker-option"
            data-sticker-kind={sticker.id}
            disabled={!ready}
            onClick={() => onPick(sticker.id)}
          >
            <img src={sticker.src} alt="" />
            <span>{sticker.name}</span>
          </button>
        ))}
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