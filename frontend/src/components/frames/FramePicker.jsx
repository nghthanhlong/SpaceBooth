export default function FramePicker({
  frames,
  selectedFrameId,
  onSelect,
}) {
  return (
    <div className="frame-grid" aria-label="Danh sách khung ảnh">
      {frames.map((frame) => (
        <button
          key={frame.id}
          type="button"
          className="frame-option"
          aria-pressed={selectedFrameId === frame.id}
          onClick={() => onSelect(frame.id)}
        >
          <span
            className="frame-preview"
            style={{ borderColor: frame.color ?? "#64748b" }}
            aria-hidden="true"
          />

          <span>{frame.name}</span>

          {selectedFrameId === frame.id && (
            <span className="selected-label">✓ Đang chọn</span>
          )}
        </button>
      ))}
    </div>
  );
}