export default function FramePicker({
  frames,
  selectedFrameId,
  onSelect,
}) {
  return (
    <div className="frame-grid">
      {frames.map((frame) => {
        const selected = frame.id === selectedFrameId;

        return (
          <button
            key={frame.id}
            type="button"
            className="frame-option"
            aria-pressed={selected}
            onClick={() => onSelect(frame.id)}
          >
            <span
              className="frame-preview"
              style={{
                position: "relative",
                overflow: "hidden",
                borderColor: frame.color ?? "transparent",
              }}
            >
              {frame.src && (
                <img
                  src={frame.src}
                  alt=""
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "fill",
                  }}
                />
              )}
            </span>

            <span>{frame.name}</span>

            {selected && (
              <span className="selected-label">✓ Đang chọn</span>
            )}
          </button>
        );
      })}
    </div>
  );
}