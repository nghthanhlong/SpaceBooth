export default function CountdownOverlay({ seconds }) {
  if (seconds === null) return null;

  return (
    <div className="countdown-overlay">
      <div className="countdown-content">
        <span className="countdown-label">Sẵn sàng tạo dáng</span>

        <strong key={seconds} className="countdown-number">
          {seconds}
        </strong>

        <span className="countdown-note">
          Có thể hạ tay và nhìn vào camera
        </span>
      </div>

      <span className="sr-only" role="status">
        Còn {seconds} giây
      </span>
    </div>
  );
}