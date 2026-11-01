import { useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import BoothIcon from "../layout/BoothIcon";
import "../../styles/qr-display.css";

export default function QRDisplay({
  host,
  height,
  session,
  remainingCount,
  onBack,
}) {
  const [index, setIndex] = useState(0);

  const urls = (session?.urls ?? []).filter((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  });

  if (!host || urls.length === 0) return null;

  const current = index % urls.length;
  const url = urls[current];

  return createPortal(
    <section
      className="qr-screen"
      style={{ height }}
      aria-label="Nhận ảnh đã lưu"
    >
      <header className="qr-heading">
        <div>
          <h2>Ảnh đã lưu thành công</h2>
          <p>Quét mã bằng điện thoại để mở và tải ảnh.</p>
        </div>

        <button
          type="button"
          className="qr-back"
          onClick={onBack}
          aria-label={
            remainingCount > 0 ? "Về chọn ảnh" : "Về camera"
          }
          title={
            remainingCount > 0 ? "Về chọn ảnh" : "Về camera"
          }
          data-cv-selectable
        >
          <BoothIcon direction="left" />
        </button>
      </header>

      <div className="qr-content">
        <div className="qr-preview">
          <img src={url} alt={`Ảnh đã lưu ${current + 1}`} />
        </div>

        <div className="qr-instructions">
          <div className="qr-code">
            <QRCodeSVG
              value={url}
              size={320}
              level="M"
              marginSize={4}
              bgColor="#ffffff"
              fgColor="#000000"
              title="Quét để mở ảnh đã lưu"
            />
          </div>

          <p>
            Mở camera điện thoại → quét QR → mở liên kết.
            Nhấn giữ ảnh để lưu hoặc dùng chức năng tải ảnh
            của trình duyệt.
          </p>

          <a href={url} target="_blank" rel="noreferrer">
            Mở ảnh trên máy này
          </a>
        </div>
      </div>

      <footer className="qr-footer">
        <p role="status">
          {remainingCount > 0
            ? `Còn ${remainingCount} ảnh chưa lưu · Quay lại để chọn tiếp`
            : "Đã lưu hết ảnh của lượt này. Bấm quay về để chụp tiếp."}
        </p>

        {urls.length > 1 && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setIndex((previous) => previous + 1)}
            data-cv-selectable
          >
            QR ảnh tiếp theo ({current + 1}/{urls.length})
          </button>
        )}
      </footer>
    </section>,
    host,
  );
}