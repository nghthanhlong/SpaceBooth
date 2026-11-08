export default function CountdownOverlay({
  seconds,
  paused = false,
  pauseMessage = "",
}) {
  if (seconds === null) return null;

  return (
    <div className={`countdown-overlay ${paused ? "is-paused" : ""}`}>
      <div className="countdown-content">
        <span className="countdown-label">
          {paused ? "Đã tạm dừng đếm ngược" : "Sẵn sàng tạo dáng"}
        </span>

        <strong key={seconds} className="countdown-number">
          {seconds}
        </strong>

        <span className="countdown-note">
          {paused
            ? pauseMessage || "Hãy nhìn về phía camera để tiếp tục"
            : "Có thể hạ tay và nhìn vào camera"}
        </span>
      </div>

      <span className="sr-only" role="status">
        {paused ? "Đang tạm dừng đếm ngược" : `Còn ${seconds} giây`}
      </span>
    </div>
  );
}
