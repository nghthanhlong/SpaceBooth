import { useEffect, useRef, useState } from "react";
import useWebcam from "../../hooks/useWebcam";

export default function CameraStage() {
  const cameraCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const [aspectRatio, setAspectRatio] = useState("16 / 9");

  const { videoRef, status, error, retry } = useWebcam();

  useEffect(() => {
    if (status !== "ready") return;

    const video = videoRef.current;
    const cameraCanvas = cameraCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;

    const cameraContext = cameraCanvas.getContext("2d");
    const overlayContext = overlayCanvas.getContext("2d");

    let animationId;

    function draw() {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const width = video.videoWidth;
        const height = video.videoHeight;

        // Đồng bộ kích thước hai Canvas với camera thực tế.
        if (
          cameraCanvas.width !== width ||
          cameraCanvas.height !== height
        ) {
          cameraCanvas.width = width;
          cameraCanvas.height = height;

          overlayCanvas.width = width;
          overlayCanvas.height = height;

          setAspectRatio(`${width} / ${height}`);
        }

        // Vẽ hình camera theo kiểu gương.
        cameraContext.save();
        cameraContext.translate(width, 0);
        cameraContext.scale(-1, 1);
        cameraContext.drawImage(video, 0, 0, width, height);
        cameraContext.restore();

        // Vẽ viền thử để kiểm tra lớp overlay.
        overlayContext.clearRect(0, 0, width, height);
        overlayContext.strokeStyle = "#c4b5fd";
        overlayContext.lineWidth = 8;
        overlayContext.strokeRect(4, 4, width - 8, height - 8);
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [status, videoRef]);

  return (
    <section className="camera-section">

      <p className="camera-status" role="status">
        {status === "ready"
          ? "Camera đang hoạt động"
          : status === "loading"
            ? "Đang mở camera..."
            : "Camera chưa sẵn sàng"}
      </p>

      <div className="camera-stage" style={{ aspectRatio }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          hidden
        />

        <canvas
          ref={cameraCanvasRef}
          className="camera-layer"
          aria-label="Hình ảnh trực tiếp từ webcam"
        />

        <canvas
          ref={overlayCanvasRef}
          className="overlay-layer"
          aria-hidden="true"
        />

        {status !== "ready" && (
          <div className="camera-message">
            {status === "loading" ? (
              <p>Hãy cho phép trình duyệt sử dụng camera</p>
            ) : (
              <>
                <p role="alert">{error}</p>
                <button type="button" onClick={retry}>
                  Thử lại
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}