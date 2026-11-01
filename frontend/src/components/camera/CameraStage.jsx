import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { CvEngine, DEFAULT_ENGINE } from "spacebooth-cv";
import useWebcam from "../../hooks/useWebcam";
import { createPhotoSession, getPhotoSessions } from "../../firebase";
import { CvUiContext } from "./CvUiContext";

function drawPhotoFrame(ctx, width, height, frame) {
  if (!frame?.color) return;

  ctx.save();
  ctx.strokeStyle = frame.color;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, width - 10, height - 10);
  ctx.restore();
}

function newOverlayState() {
  return {
    captureProgress: 0,
    countdownActive: false,
    secondsLeft: 0,
    flashUntil: 0,
  };
}

function drawOverlay(ctx, canvas, data, state, frame) {
  const { width, height } = canvas;

  ctx.clearRect(0, 0, width, height);
  drawPhotoFrame(ctx, width, height, frame);
  ctx.save();

  // Tiến trình nhận quyền nằm cạnh cổ tay.
  if (data?.controller.kind === "arming") {
    const hand = data.hands.find(
      (item) => item.id === data.controller.handId,
    );

    const wrist = hand?.landmarks[0];

    if (wrist) {
      ctx.beginPath();
      ctx.arc(
        wrist.x * width,
        wrist.y * height,
        28,
        -Math.PI / 2,
        -Math.PI / 2 + data.controller.progress * Math.PI * 2,
      );
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }

  // Con trỏ chính được vẽ ở BoothPage, không vẽ trùng trong camera.
  if (state.captureProgress > 0 && !state.countdownActive) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(12, 12, width - 24, 42);
    ctx.fillStyle = "#ffffff";
    ctx.font = "18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `Giữ chữ V: ${Math.round(state.captureProgress * 100)}%`,
      width / 2,
      33,
      width - 48,
    );
  }

  if (state.countdownActive && state.secondsLeft > 0) {
    const x = width / 2;
    const y = height / 2;

    ctx.beginPath();
    ctx.arc(x, y, 64, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fill();

    ctx.fillStyle = "#facc15";
    ctx.font = "bold 72px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(state.secondsLeft), x, y);

    ctx.font = "18px system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Sẵn sàng tạo dáng!", x, y + 88);
  }

  const now = performance.now();

  if (state.flashUntil > now) {
    const opacity = ((state.flashUntil - now) / 400) * 0.8;
    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();
}

function formatSessionDate(timestamp) {
  const date =
    timestamp?.toDate?.() ?? (timestamp ? new Date(timestamp) : null);

  if (!date || Number.isNaN(date.getTime())) {
    return "Chưa có thời gian";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function CameraStage({ frame }) {
  const bridge = useContext(CvUiContext);

  const cameraCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const frameDataRef = useRef(null);
  const selectedFrameRef = useRef(frame);
  const captureHandlerRef = useRef(() => {});
  const overlayStateRef = useRef(newOverlayState());
  const previewUrlsRef = useRef(new Set());
  const capturedCountRef = useRef(0);
  const captureReservationsRef = useRef(0);
  const uploadInProgressRef = useRef(false);
  const mountedRef = useRef(false);

  const [aspectRatio, setAspectRatio] = useState("16 / 9");
  const [capturedPhotos, setCapturedPhotos] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [savedAlbums, setSavedAlbums] = useState([]);
  const [isLoadingAlbums, setIsLoadingAlbums] = useState(true);
  const [albumError, setAlbumError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [cvStatus, setCvStatus] = useState("waiting");
  const [cvError, setCvError] = useState("");

  const { videoRef, status, error, retry } = useWebcam();

  useEffect(() => {
    selectedFrameRef.current = frame;
  }, [frame]);

  useEffect(() => {
    bridge?.reportStatus(status, cvStatus);
  }, [bridge, status, cvStatus]);

  useEffect(() => {
    const urls = previewUrlsRef.current;
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const loadSavedAlbums = useCallback(async () => {
    try {
      const albums = await getPhotoSessions();

      if (mountedRef.current) {
        setSavedAlbums(albums);
        setAlbumError("");
      }
    } catch (loadError) {
      if (mountedRef.current) {
        setAlbumError(loadError.message || "Không thể tải album.");
      }
    } finally {
      if (mountedRef.current) setIsLoadingAlbums(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    getPhotoSessions()
      .then((albums) => {
        if (active) setSavedAlbums(albums);
      })
      .catch((loadError) => {
        if (active) {
          setAlbumError(loadError.message || "Không thể tải album.");
        }
      })
      .finally(() => {
        if (active) setIsLoadingAlbums(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function handleRetryCamera() {
    setCvStatus("waiting");
    setCvError("");
    retry();
  }

  function handleReloadAlbums() {
    setIsLoadingAlbums(true);
    setAlbumError("");
    loadSavedAlbums();
  }

  useEffect(() => {
    if (status !== "ready") return;

    let active = true;

    const engine = new CvEngine(videoRef.current, {
      controller: {
        ...DEFAULT_ENGINE.controller,
        countdownMs: 10_000,
      },
    });

    const unsubs = [
      engine.on("frame", (data) => {
        if (!active) return;

        frameDataRef.current = data;
        bridge?.reportFrame(data);
      }),

      engine.on("pinchStart", (point) => {
        if (active && !overlayStateRef.current.countdownActive) {
          bridge?.handlePinchStart(point);
        }
      }),

      engine.on("captureProgress", ({ progress }) => {
        if (active) {
          overlayStateRef.current.captureProgress = progress;
        }
      }),

      engine.on("countdownStart", ({ durationMs }) => {
        if (!active) return;

        overlayStateRef.current.countdownActive = true;
        overlayStateRef.current.secondsLeft = Math.ceil(durationMs / 1000);
        overlayStateRef.current.captureProgress = 0;
      }),

      engine.on("countdown", ({ secondsLeft }) => {
        if (active) {
          overlayStateRef.current.secondsLeft = secondsLeft;
        }
      }),

      engine.on("capture", () => {
        if (!active) return;

        overlayStateRef.current.countdownActive = false;
        overlayStateRef.current.secondsLeft = 0;
        overlayStateRef.current.captureProgress = 0;
        overlayStateRef.current.flashUntil = performance.now() + 400;
        captureHandlerRef.current();
      }),
    ];

    engine
      .start()
      .then(() => {
        if (!active) {
          engine.stop();
          return;
        }

        setCvStatus("ready");
        setCvError("");
      })
      .catch((startError) => {
        engine.stop();

        if (active) {
          setCvStatus("error");
          setCvError(startError.message || "Không tải được nhận diện.");
        }
      });

    return () => {
      active = false;
      unsubs.forEach((unsubscribe) => unsubscribe());
      engine.stop();
      frameDataRef.current = null;
      overlayStateRef.current = newOverlayState();
      bridge?.resetCv();
    };
  }, [status, videoRef, bridge]);

  useEffect(() => {
    if (status !== "ready") return;

    const video = videoRef.current;
    const camera = cameraCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    const cameraContext = camera.getContext("2d");
    const overlayContext = overlay.getContext("2d");

    if (!cameraContext || !overlayContext) return;

    let animationId;

    function draw() {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const width = video.videoWidth;
        const height = video.videoHeight;

        if (camera.width !== width || camera.height !== height) {
          camera.width = width;
          camera.height = height;
          overlay.width = width;
          overlay.height = height;
          setAspectRatio(`${width} / ${height}`);
        }

        cameraContext.save();
        cameraContext.translate(width, 0);
        cameraContext.scale(-1, 1);
        cameraContext.drawImage(video, 0, 0, width, height);
        cameraContext.restore();

        drawOverlay(
          overlayContext,
          overlay,
          frameDataRef.current,
          overlayStateRef.current,
          selectedFrameRef.current,
        );
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [status, videoRef]);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;

    if (
      status !== "ready" ||
      !video ||
      video.readyState < 2 ||
      video.videoWidth === 0
    ) {
      setFeedback("Camera chưa sẵn sàng.");
      return;
    }

    if (uploadInProgressRef.current) {
      setFeedback("Hãy chờ lưu album xong trước khi chụp tiếp.");
      return;
    }

    if (capturedCountRef.current + captureReservationsRef.current >= 5) {
      setFeedback("Đã đủ 5 ảnh. Hãy lưu album trước khi chụp tiếp.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      setFeedback("Không thể tạo ảnh.");
      return;
    }

    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    drawPhotoFrame(ctx, canvas.width, canvas.height, selectedFrameRef.current);
    captureReservationsRef.current += 1;

    canvas.toBlob((blob) => {
      captureReservationsRef.current -= 1;

      if (!mountedRef.current) return;

      if (!blob) {
        setFeedback("Không thể tạo ảnh. Hãy thử lại.");
        return;
      }

      const file = new File([blob], `photo_${Date.now()}.png`, {
        type: "image/png",
      });

      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      capturedCountRef.current += 1;

      setCapturedPhotos((previous) => [...previous, { file, previewUrl }]);
      setFeedback("Đã chụp ảnh.");
    }, "image/png");
  }, [status, videoRef]);

  useEffect(() => {
    captureHandlerRef.current = handleCapture;
  }, [handleCapture]);

  async function handleSaveSession() {
    if (uploadInProgressRef.current) return;

    if (captureReservationsRef.current > 0) {
      setFeedback("Ảnh đang được xử lý. Hãy chờ một chút.");
      return;
    }

    if (capturedPhotos.length === 0) {
      setFeedback("Hãy chụp ít nhất một ảnh trước.");
      return;
    }

    uploadInProgressRef.current = true;
    setIsUploading(true);
    setFeedback("Đang lưu album…");

    try {
      const result = await createPhotoSession(
        capturedPhotos.map(({ file }) => file),
      );

      if (!mountedRef.current) return;

      if (!result.success) {
        setFeedback(`Lưu album thất bại: ${result.error}`);
        return;
      }

      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
      capturedCountRef.current = 0;

      setCapturedPhotos([]);
      setFeedback("Đã lưu album thành công.");
      await loadSavedAlbums();
    } catch (saveError) {
      if (mountedRef.current) {
        setFeedback(
          `Không thể lưu album: ${saveError.message || "Hãy thử lại."}`,
        );
      }
    } finally {
      uploadInProgressRef.current = false;
      if (mountedRef.current) setIsUploading(false);
    }
  }

  return (
    <section className="camera-section">
      <div className="camera-stage" style={{ aspectRatio }}>
        <video ref={videoRef} autoPlay muted playsInline hidden />

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
              <p>Hãy cho phép trình duyệt sử dụng camera.</p>
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

      <div className="camera-toolbar">
        <span className="camera-photo-count">
          {capturedPhotos.length}/5 ảnh
        </span>

        <div className="camera-toolbar-buttons">
          <button
            type="button"
            className="primary-button"
            onClick={handleCapture}
            disabled={
              status !== "ready" ||
              capturedPhotos.length >= 5 ||
              isUploading
            }
          >
            Chụp ảnh
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={handleSaveSession}
            disabled={isUploading || capturedPhotos.length === 0}
          >
            {isUploading ? "Đang lưu…" : "Lưu album"}
          </button>
        </div>
      </div>

      <p className="photo-feedback" role="status">
        {feedback || "Giơ chữ V để bắt đầu đếm ngược chụp ảnh."}
      </p>

      {status === "ready" && cvStatus === "error" && (
        <div className="cv-error" role="alert">
          <p>Nhận diện chưa hoạt động: {cvError}</p>
          <button type="button" onClick={handleRetryCamera}>
            Thử lại nhận diện
          </button>
        </div>
      )}

      {capturedPhotos.length > 0 && (
        <section className="photo-controls" aria-label="Ảnh chờ lưu">
          <h2>Ảnh vừa chụp</h2>
          <div className="captured-photos">
            {capturedPhotos.map(({ previewUrl }, index) => (
              <img
                key={previewUrl}
                src={previewUrl}
                alt={`Ảnh vừa chụp ${index + 1}`}
              />
            ))}
          </div>
        </section>
      )}

      <details className="saved-albums">
        <summary>Album đã lưu</summary>

        <div className="saved-albums-heading">
          <p>Các album đã lưu gần đây</p>
          <button
            type="button"
            onClick={handleReloadAlbums}
            disabled={isLoadingAlbums}
          >
            {isLoadingAlbums ? "Đang tải…" : "Tải lại"}
          </button>
        </div>

        {albumError && <p role="alert">{albumError}</p>}

        {!albumError && !isLoadingAlbums && savedAlbums.length === 0 && (
          <p>Chưa có album nào.</p>
        )}

        <div className="album-list">
          {savedAlbums.map((album) => (
            <article className="album-card" key={album.id}>
              <h3>Album {album.sessionId || album.id}</h3>
              <p>{formatSessionDate(album.createdAt)}</p>

              <div className="album-photos">
                {(Array.isArray(album.allPhotos) ? album.allPhotos : []).map(
                  (url, index) => (
                    <a
                      key={`${album.id}-${index}-${url}`}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img src={url} alt={`Ảnh ${index + 1} trong album`} />
                    </a>
                  ),
                )}
              </div>
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}