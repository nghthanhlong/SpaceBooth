import { useEffect, useRef, useState } from "react";
import useWebcam from "../../hooks/useWebcam";
import { CvEngine } from "spacebooth-cv"; // từ package đã link workspace

export default function CameraStage() {
  const cameraCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const engineRef = useRef(null);
  const [aspectRatio, setAspectRatio] = useState("16 / 9");
  const [frameData, setFrameData] = useState(null);

  const { videoRef, status, error, retry } = useWebcam();

  // 1. Khởi tạo CvEngine khi camera sẵn sàng
  useEffect(() => {
    if (status !== "ready") return;
    const video = videoRef.current;

    const engine = new CvEngine(video); // video GỐC, chưa mirror
    engineRef.current = engine;

    engine.on("frame", (data) => setFrameData(data)); // { hands, faces, cursor, pinching, size... }
    engine.start();

    return () => engine.stop();
  }, [status, videoRef]);

  // 2. Vẽ camera (giữ nguyên như cũ)
  useEffect(() => {
    if (status !== "ready") return;
    const video = videoRef.current;
    const cameraCanvas = cameraCanvasRef.current;
    const cameraContext = cameraCanvas.getContext("2d");
    let animationId;

    function draw() {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (cameraCanvas.width !== width || cameraCanvas.height !== height) {
          cameraCanvas.width = width;
          cameraCanvas.height = height;
          overlayCanvasRef.current.width = width;
          overlayCanvasRef.current.height = height;
          setAspectRatio(`${width} / ${height}`);
        }
        cameraContext.save();
        cameraContext.translate(width, 0);
        cameraContext.scale(-1, 1);
        cameraContext.drawImage(video, 0, 0, width, height);
        cameraContext.restore();
      }
      animationId = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animationId);
  }, [status, videoRef]);

  // 3. Vẽ overlay DỰA TRÊN DATA từ CvEngine (thay cho strokeRect test cũ)
  useEffect(() => {
    if (!frameData) return;
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCanvas.getContext("2d");
    const { width, height } = overlayCanvas;

    ctx.clearRect(0, 0, width, height);

    // Cursor — landmark đã normalized (0-1) và đã mirror sẵn từ engine
    if (frameData.cursor) {
      ctx.beginPath();
      ctx.arc(frameData.cursor.x * width, frameData.cursor.y * height, 12, 0, Math.PI * 2);
      ctx.fillStyle = frameData.pinching ? "#f472b6" : "#c4b5fd";
      ctx.fill();
    }

    // Hand landmarks (tuỳ chọn, để debug)
    frameData.hands?.forEach((hand) => {
      hand.landmarks.forEach((lm) => {
        ctx.beginPath();
        ctx.arc(lm.x * width, lm.y * height, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#a78bfa";
        ctx.fill();
      });
    });
  }, [frameData]);

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