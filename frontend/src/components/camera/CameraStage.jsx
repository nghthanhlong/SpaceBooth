import { useCallback, useEffect, useRef, useState } from "react";
import useWebcam from "../../hooks/useWebcam";
import { CvEngine, DEFAULT_ENGINE } from "spacebooth-cv"; // từ package đã link workspace
import { createPhotoSession, getPhotoSessions } from "../../firebase";

// ─── Hằng số overlay ───────────────────────────────────────────────────────
const CURSOR_RADIUS = 14;
const LANDMARK_RADIUS = 3;

// ─── Vẽ overlay lên canvas ─────────────────────────────────────────────────
function drawOverlay(ctx, overlayCanvas, frameData, cvOverlay) {
  const { width, height } = overlayCanvas;
  ctx.clearRect(0, 0, width, height);

  if (!frameData) return;

  // 1. Hand landmarks (debug, nhỏ)
  frameData.hands?.forEach((hand) => {
    hand.landmarks.forEach((lm) => {
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, LANDMARK_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#a78bfa";
      ctx.fill();
    });
  });

  // 2. Cursor chính — màu theo trạng thái
  if (frameData.cursor) {
    const cx = frameData.cursor.x * width;
    const cy = frameData.cursor.y * height;

    // Màu cursor:
    //   hồng  → đang pinch
    //   vàng  → đang countdown chụp ảnh
    //   tím   → nhận diện bình thường (có controller)
    let cursorColor;
    if (cvOverlay.countdownActive) {
      cursorColor = "#facc15"; // vàng
    } else if (frameData.pinching) {
      cursorColor = "#f472b6"; // hồng
    } else {
      cursorColor = "#c4b5fd"; // tím
    }

    // Vòng ngoài mờ để dễ thấy hơn
    ctx.beginPath();
    ctx.arc(cx, cy, CURSOR_RADIUS + 4, 0, Math.PI * 2);
    ctx.strokeStyle = cursorColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Chấm trong
    ctx.beginPath();
    ctx.arc(cx, cy, CURSOR_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = cursorColor;
    ctx.fill();

    // 3. Ring progress khi giữ Victory (captureProgress)
    if (cvOverlay.captureProgress > 0 && !cvOverlay.countdownActive) {
      ctx.beginPath();
      ctx.arc(cx, cy, CURSOR_RADIUS + 12, -Math.PI / 2,
        -Math.PI / 2 + cvOverlay.captureProgress * Math.PI * 2);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }

  // 4. Countdown số to ở giữa màn hình
  if (cvOverlay.countdownActive && cvOverlay.secondsLeft > 0) {
    const cx = width / 2;
    const cy = height / 2;

    // Vòng tròn nền mờ
    ctx.beginPath();
    ctx.arc(cx, cy, 64, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 4;
    ctx.stroke();

    // Số đếm
    ctx.fillStyle = "#facc15";
    ctx.font = "bold 72px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(cvOverlay.secondsLeft), cx, cy);

    // Chữ nhỏ bên dưới
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Sẵn sàng pose!", cx, cy + 82);
  }

  // 5. Flash trắng khi vừa chụp
  if (cvOverlay.flashUntil > 0 && performance.now() < cvOverlay.flashUntil) {
    const elapsed = performance.now() - (cvOverlay.flashUntil - 400);
    const alpha = Math.max(0, 0.8 - elapsed / 400);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(0, 0, width, height);
  }
}

// ─── Format ngày ────────────────────────────────────────────────────────────
function formatSessionDate(timestamp) {
  const date = timestamp?.toDate?.() ?? (timestamp ? new Date(timestamp) : null);
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : "Chưa có thời gian";
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function CameraStage() {
  const cameraCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const engineRef = useRef(null);
  const captureHandlerRef = useRef(() => {});
  const [aspectRatio, setAspectRatio] = useState("16 / 9");
  const [frameData, setFrameData] = useState(null);
  const frameDataRef = useRef(null); // mirror của frameData để rAF loop đọc latest

  const [capturedPhotos, setCapturedPhotos] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [savedAlbums, setSavedAlbums] = useState([]);
  const [isLoadingAlbums, setIsLoadingAlbums] = useState(true);
  const [albumError, setAlbumError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [cvStatus, setCvStatus] = useState("waiting");
  const [cvError, setCvError] = useState("");
  const previewUrlsRef = useRef(new Set());
  const captureReservationsRef = useRef(0);

  // Overlay state — dùng ref để vẽ canvas không cần re-render React
  const cvOverlayRef = useRef({
    captureProgress: 0,   // [0-1] tiến độ giữ Victory
    countdownActive: false,
    secondsLeft: 0,
    flashUntil: 0,        // timestamp ms kết thúc flash
  });

  const { videoRef, status, error, retry } = useWebcam();

  // ── Album helpers ──────────────────────────────────────────────────────────
  const loadSavedAlbums = useCallback(async () => {
    try {
      const albums = await getPhotoSessions();
      setSavedAlbums(albums);
      setAlbumError("");
    } catch (loadError) {
      console.error("Lỗi tải album:", loadError);
      setAlbumError(loadError.message || "Không thể tải album đã lưu.");
    } finally {
      setIsLoadingAlbums(false);
    }
  }, []);

  const handleReloadAlbums = () => {
    setIsLoadingAlbums(true);
    setAlbumError("");
    loadSavedAlbums();
  };

  const handleRetryCamera = () => {
    setCvStatus("waiting");
    setCvError("");
    retry();
  };

  // ── Load album lần đầu ────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    getPhotoSessions()
      .then((albums) => { if (isMounted) setSavedAlbums(albums); })
      .catch((loadError) => {
        console.error("Lỗi tải album:", loadError);
        if (isMounted) setAlbumError(loadError.message || "Không thể tải album đã lưu.");
      })
      .finally(() => { if (isMounted) setIsLoadingAlbums(false); });
    return () => { isMounted = false; };
  }, []);

  // ── Cleanup object URLs ───────────────────────────────────────────────────
  useEffect(() => () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  // ── Khởi động CV Engine + subscribe events ────────────────────────────────
  useEffect(() => {
    if (status !== "ready") return;

    let isActive = true;
    const video = videoRef.current;

    // Countdown 10 giây theo yêu cầu.
    // Deep-merge controller để không mất các defaults khác (dwellMs, gestureMinScore...).
    const engine = new CvEngine(video, {
      controller: { ...DEFAULT_ENGINE.controller, countdownMs: 10_000 },
    });
    engineRef.current = engine;

    const unsubs = [
      // Frame data (landmarks, cursor, pinch...)
      engine.on("frame", (data) => {
        frameDataRef.current = data;
        setFrameData(data);
      }),

      // Tiến độ giữ Victory để bắt đầu đếm ngược
      engine.on("captureProgress", ({ progress }) => {
        cvOverlayRef.current.captureProgress = progress;
      }),

      // Bắt đầu đếm ngược
      engine.on("countdownStart", ({ durationMs }) => {
        cvOverlayRef.current.countdownActive = true;
        cvOverlayRef.current.secondsLeft = Math.ceil(durationMs / 1000);
        cvOverlayRef.current.captureProgress = 0;
      }),

      // Mỗi giây trong countdown
      engine.on("countdown", ({ secondsLeft }) => {
        cvOverlayRef.current.secondsLeft = secondsLeft;
      }),

      // Chụp ảnh: flash + reset
      engine.on("capture", () => {
        cvOverlayRef.current.flashUntil = performance.now() + 400;
        cvOverlayRef.current.countdownActive = false;
        cvOverlayRef.current.secondsLeft = 0;
        captureHandlerRef.current();
      }),
    ];

    engine.start()
      .then(() => { if (isActive) setCvStatus("ready"); })
      .catch((startError) => {
        console.error("Lỗi khởi động CV:", startError);
        if (isActive) {
          setCvStatus("error");
          setCvError(startError.message || "Không thể tải model nhận diện.");
        }
      });

    return () => {
      isActive = false;
      unsubs.forEach((fn) => fn());
      engine.stop();
      if (engineRef.current === engine) engineRef.current = null;
      // Reset overlay state
      cvOverlayRef.current = {
        captureProgress: 0, countdownActive: false,
        secondsLeft: 0, flashUntil: 0,
      };
    };
  }, [status, videoRef]);

  // ── Draw camera (mirrored) ─────────────────────────────────────────────────
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

  // ── Draw overlay (cursor / countdown / flash) ──────────────────────────────
  // Dùng rAF độc lập để flash và countdown render mượt, không phụ thuộc frameData
  useEffect(() => {
    if (status !== "ready") return;
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCanvas.getContext("2d");
    let animationId;

    function renderOverlay() {
      drawOverlay(ctx, overlayCanvas, frameDataRef.current, cvOverlayRef.current);
      animationId = requestAnimationFrame(renderOverlay);
    }
    renderOverlay();
    return () => cancelAnimationFrame(animationId);
  }, [status]); // dùng frameDataRef + cvOverlayRef → không cần deps khác

  // ── frameData thay đổi: không cần vẽ riêng nữa vì rAF loop đã bao phủ ─────
  // (xoá useEffect cũ vẽ frameData để tránh double-draw)

  // ── Chụp ảnh manual / từ CV ───────────────────────────────────────────────
  const handleCapture = useCallback(() => {
    const cameraCanvas = cameraCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (
      status !== "ready" ||
      !cameraCanvas ||
      !overlayCanvas ||
      cameraCanvas.width === 0
    ) {
      setFeedback("Camera chưa sẵn sàng để chụp.");
      return;
    }
    if (capturedPhotos.length + captureReservationsRef.current >= 5) {
      setFeedback("Album đã đủ 5 ảnh.");
      return;
    }

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = cameraCanvas.width;
    tempCanvas.height = cameraCanvas.height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) {
      setFeedback("Không thể tạo vùng đệm để chụp ảnh.");
      return;
    }

    // cameraCanvas đã mirrored (selfie-style), chỉ copy thẳng
    ctx.drawImage(cameraCanvas, 0, 0);
    //ctx.drawImage(overlayCanvas, 0, 0);

    captureReservationsRef.current += 1;
    tempCanvas.toBlob((blob) => {
      captureReservationsRef.current -= 1;
      if (!blob) {
        setFeedback("Không thể tạo ảnh. Vui lòng thử chụp lại.");
        return;
      }
      const file = new File([blob], `photo_${Date.now()}.png`, { type: "image/png" });
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      setFeedback("Đã chụp ảnh. Bấm Lưu album để lưu ảnh lên hệ thống.");
      setCapturedPhotos((previous) => [...previous, { file, previewUrl }]);
    }, "image/png");
  }, [capturedPhotos.length, status]);

  useEffect(() => {
    captureHandlerRef.current = handleCapture;
  }, [handleCapture]);

  // ── Lưu session lên Cloudinary + Firestore ─────────────────────────────────
  const handleSaveSession = async () => {
    if (capturedPhotos.length === 0) {
      setFeedback("Chưa có ảnh nào. Hãy chụp ít nhất một ảnh trước.");
      return;
    }
    setIsUploading(true);
    setFeedback("");
    try {
      const result = await createPhotoSession(capturedPhotos.map(({ file }) => file));
      if (!result.success) {
        setFeedback(`Lưu album thất bại: ${result.error}`);
        return;
      }
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
      setCapturedPhotos([]);
      setFeedback(`Đã lưu album thành công. Mã session: ${result.sessionId}`);
      await loadSavedAlbums();
    } catch (saveError) {
      console.error("Lỗi lưu album:", saveError);
      setFeedback(`Lưu album thất bại: ${saveError.message || "Lỗi không xác định."}`);
    } finally {
      setIsUploading(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="camera-section">

      <p className="camera-status" role="status">
        {status === "ready"
          ? "Camera đang hoạt động"
          : status === "loading"
            ? "Đang mở camera..."
            : "Camera chưa sẵn sàng"}
      </p>
      <p className="camera-status" role="status">
        {status !== "ready"
          ? "Nhận diện cử chỉ sẽ bắt đầu khi camera sẵn sàng"
          : cvStatus === "ready"
            ? "Nhận diện cử chỉ đang hoạt động"
            : cvStatus === "error"
              ? `Nhận diện cử chỉ không khởi động được: ${cvError}`
              : "Đang tải model nhận diện..."}
      </p>
      {status === "ready" && cvStatus === "error" && (
        <button type="button" onClick={handleRetryCamera}>
          Thử khởi động lại nhận diện
        </button>
      )}

      <div className="camera-photo-actions">
        <span className="camera-photo-count">
          Ảnh đã chụp: {capturedPhotos.length}/5
        </span>
        <button
          type="button"
          onClick={handleCapture}
          disabled={status !== "ready" || capturedPhotos.length >= 5}
        >
          Chụp ảnh
        </button>
        <button
          type="button"
          className="save-album-button"
          onClick={handleSaveSession}
          disabled={isUploading}
        >
          {isUploading ? "Đang lưu album..." : "Lưu album"}
        </button>
      </div>
      {feedback && <p className="photo-feedback" role="status">{feedback}</p>}

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

        {/* Overlay canvas: cursor, countdown, flash */}
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
                <button type="button" onClick={handleRetryCamera}>
                  Thử lại
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <section className="photo-controls" aria-labelledby="photo-controls-title">
        <h2 id="photo-controls-title">Chụp ảnh và lưu album</h2>
        <p>Chụp tối đa 5 ảnh. Album được lưu trên Cloudinary và thông tin được ghi vào Firestore.</p>
        {capturedPhotos.length > 0 && (
          <p className="photo-feedback">
            Đã chụp {capturedPhotos.length} ảnh. Bấm "Lưu album" trên khung camera để lưu.
          </p>
        )}
        {status !== "ready" && <p>Chờ camera sẵn sàng để bắt đầu chụp.</p>}
        {capturedPhotos.length > 0 && (
          <div className="captured-photos" aria-label="Ảnh chờ lưu">
            {capturedPhotos.map(({ previewUrl }, index) => (
              <img key={previewUrl} src={previewUrl} alt={`Ảnh vừa chụp ${index + 1}`} />
            ))}
          </div>
        )}
      </section>

      <section className="saved-albums" aria-labelledby="saved-albums-title">
        <div className="saved-albums-heading">
          <div>
            <h2 id="saved-albums-title">Album đã lưu</h2>
            <p>Hiển thị tối đa 20 album mới nhất từ Firestore.</p>
          </div>
          <button type="button" onClick={handleReloadAlbums} disabled={isLoadingAlbums}>
            {isLoadingAlbums ? "Đang tải..." : "Tải lại"}
          </button>
        </div>
        {albumError && <p className="photo-feedback" role="alert">{albumError}</p>}
        {!albumError && !isLoadingAlbums && savedAlbums.length === 0 && (
          <p>Chưa có album nào được lưu.</p>
        )}
        <div className="album-list">
          {savedAlbums.map((album) => (
            <article className="album-card" key={album.id}>
              <div className="album-card-heading">
                <h3>Session {album.sessionId || album.id}</h3>
                <time>{formatSessionDate(album.createdAt)}</time>
              </div>
              <div className="album-photos">
                {(Array.isArray(album.allPhotos) ? album.allPhotos : []).map((url, index) => (
                  <a key={`${album.id}-${url}`} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={`Ảnh ${index + 1} trong album ${album.sessionId || album.id}`} />
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
