import { useEffect, useRef, useState } from "react";
import useWebcam from "../../hooks/useWebcam";
import { CvEngine } from "spacebooth-cv"; // từ package đã link workspace
import { createPhotoSession } from "../../firebase"; // Import hàm upload Firebase

export default function CameraStage() {
  const cameraCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const engineRef = useRef(null);
  const [aspectRatio, setAspectRatio] = useState("16 / 9");
  const [frameData, setFrameData] = useState(null);
  
  // State lưu 5 ảnh
  const [capturedPhotos, setCapturedPhotos] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

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

  // 4. Hàm chụp ảnh: Gộp Camera + Overlay (Sticker) thành 1 file
  const handleCapture = () => {
    const cameraCanvas = cameraCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!cameraCanvas || !overlayCanvas) return;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = cameraCanvas.width;
    tempCanvas.height = cameraCanvas.height;
    const ctx = tempCanvas.getContext("2d");

    ctx.save();
    ctx.translate(tempCanvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(cameraCanvas, 0, 0);
    ctx.restore();
    ctx.drawImage(overlayCanvas, 0, 0);

    tempCanvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `photo_${Date.now()}.png`, { type: "image/png" });
        setCapturedPhotos((prev) => {
          if (prev.length >= 5) return prev;
          const newPhotos = [...prev, file];
          if (newPhotos.length === 5) {
            alert("Đã chụp đủ 5 ảnh! Hãy bấm 'Lưu Album' để Upload lên Firebase.");
          }
          return newPhotos;
        });
      }
    }, "image/png");
  };

  // 5. Hàm Lưu Album (Upload 5 ảnh lên Firebase)
  const handleSaveSession = async () => {
    if (capturedPhotos.length === 0) {
      alert("Chưa có ảnh nào! Hãy chụp trước.");
      return;
    }
    
    setIsUploading(true);
    const result = await createPhotoSession(capturedPhotos);
    setIsUploading(false);

    if (result.success) {
      alert(`Lưu Album thành công!\nSession ID: ${result.sessionId}\nLink ảnh 1: ${result.urls[0]}`);
      setCapturedPhotos([]);
    } else {
      alert("Lỗi Upload: " + result.error);
    }
  };

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

      {/* 6. Khu vực nút bấm Test Upload */}
      {status === "ready" && (
        <div style={{ marginTop: "20px", padding: "15px", background: "#1e293b", borderRadius: "8px", textAlign: "center" }}>
          <h3>Khu vực Test Upload</h3>
          
          <button 
            onClick={handleCapture} 
            disabled={capturedPhotos.length >= 5}
            style={{ padding: "10px 20px", marginRight: "10px", background: "#3b82f6", color: "white", border: "none", borderRadius: "5px", cursor: capturedPhotos.length >= 5 ? "not-allowed" : "pointer" }}
          >
            Chụp Ảnh ({capturedPhotos.length}/5)
          </button>

          <button 
            onClick={handleSaveSession} 
            disabled={capturedPhotos.length === 0 || isUploading}
            style={{ padding: "10px 20px", background: "#10b981", color: "white", border: "none", borderRadius: "5px", cursor: (capturedPhotos.length === 0 || isUploading) ? "not-allowed" : "pointer" }}
          >
            {isUploading ? "Đang Upload..." : "Lưu Album (Firebase)"}
          </button>

          <div style={{ display: "flex", gap: "10px", marginTop: "15px", justifyContent: "center" }}>
            {capturedPhotos.map((file, idx) => (
              <img 
                key={idx} 
                src={URL.createObjectURL(file)} 
                alt={`captured ${idx}`} 
                style={{ width: "80px", height: "80px", objectFit: "cover", border: "2px solid white", borderRadius: "4px" }} 
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}