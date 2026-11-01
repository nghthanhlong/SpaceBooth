import {
  useCallback, useContext, useEffect, useRef, useState,
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

function drawFeedback(ctx, size, data, state) {
  const { width, height } = size;
  ctx.save();

  if (data?.controller.kind === "arming") {
    const hand = data.hands.find(
      (item) => item.id === data.controller.handId,
    );
    const wrist = hand?.landmarks[0];

    if (wrist) {
      ctx.beginPath();
      ctx.arc(
        wrist.x * width, wrist.y * height, 28,
        -Math.PI / 2,
        -Math.PI / 2 + data.controller.progress * Math.PI * 2,
      );
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }

  if (state.captureProgress > 0 && !state.countdownActive) {
    ctx.fillStyle = "rgba(15, 23, 42, .85)";
    ctx.fillRect(12, 12, width - 24, 42);
    ctx.fillStyle = "#ffffff";
    ctx.font = "18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `Giữ chữ V: ${Math.round(state.captureProgress * 100)}%`,
      width / 2, 33, width - 48,
    );
  }

  if (state.countdownActive && state.secondsLeft > 0) {
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 64, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fill();
    ctx.fillStyle = "#facc15";
    ctx.font = "bold 72px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(state.secondsLeft), width / 2, height / 2);
  }

  const now = performance.now();

  if (state.flashUntil > now) {
    ctx.fillStyle = `rgba(255,255,255,${
      ((state.flashUntil - now) / 400) * 0.8
    })`;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();
}

function formatSessionDate(timestamp) {
  const date = timestamp?.toDate?.() ??
    (timestamp ? new Date(timestamp) : null);

  if (!date || Number.isNaN(date.getTime())) return "Chưa có thời gian";

  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function CameraStage({ frame }) {
  const bridge = useContext(CvUiContext);
  const cameraRef = useRef(null);
  const overlayRef = useRef(null);
  const dataRef = useRef(null);
  const frameAtRef = useRef(0);
  const selectedFrameRef = useRef(frame);
  const captureHandlerRef = useRef(() => {});
  const overlayStateRef = useRef(newOverlayState());
  const urlsRef = useRef(new Set());
  const countRef = useRef(0);
  const reservationsRef = useRef(0);
  const uploadingRef = useRef(false);
  const mountedRef = useRef(false);

  const [aspectRatio, setAspectRatio] = useState("16 / 9");
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [albums, setAlbums] = useState([]);
  const [loadingAlbums, setLoadingAlbums] = useState(true);
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
    const urls = urlsRef.current;
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const loadAlbums = useCallback(async () => {
    try {
      const result = await getPhotoSessions();

      if (mountedRef.current) {
        setAlbums(result);
        setAlbumError("");
      }
    } catch (loadError) {
      if (mountedRef.current) {
        setAlbumError(loadError.message || "Không thể tải album.");
      }
    } finally {
      if (mountedRef.current) setLoadingAlbums(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    getPhotoSessions()
      .then((result) => {
        if (active) setAlbums(result);
      })
      .catch((loadError) => {
        if (active) setAlbumError(loadError.message || "Không thể tải album.");
      })
      .finally(() => {
        if (active) setLoadingAlbums(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function retryCamera() {
    setCvStatus("waiting");
    setCvError("");
    retry();
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
        dataRef.current = data;
        frameAtRef.current = performance.now();
        bridge?.reportFrame(data);
      }),

      engine.on("pinchStart", (point) => {
        if (active && !overlayStateRef.current.countdownActive) {
          bridge?.handlePinchStart(point);
        }
      }),

      engine.on("pinchEnd", (point) => {
        if (active) bridge?.handlePinchEnd(point);
      }),

      engine.on("release", () => {
        if (active) bridge?.cancelDrag("Đã mất quyền. Hủy kéo sticker.");
      }),

      engine.on("captureProgress", ({ progress }) => {
        if (active) overlayStateRef.current.captureProgress = progress;
      }),

      engine.on("countdownStart", ({ durationMs }) => {
        if (!active) return;
        bridge?.cancelDrag("Bắt đầu chụp. Đã hủy sticker chưa dán.");
        overlayStateRef.current.countdownActive = true;
        overlayStateRef.current.secondsLeft = Math.ceil(durationMs / 1000);
        overlayStateRef.current.captureProgress = 0;
      }),

      engine.on("countdown", ({ secondsLeft }) => {
        if (active) overlayStateRef.current.secondsLeft = secondsLeft;
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

    engine.start()
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
      dataRef.current = null;
      overlayStateRef.current = newOverlayState();
      bridge?.resetCv();
    };
  }, [status, videoRef, bridge]);

  useEffect(() => {
    if (status !== "ready") return;

    const video = videoRef.current;
    const camera = cameraRef.current;
    const overlay = overlayRef.current;
    const cameraContext = camera.getContext("2d");
    const ctx = overlay.getContext("2d");

    if (!cameraContext || !ctx) return;
    let animationId;

    function draw() {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const size = { width, height };

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

        ctx.clearRect(0, 0, width, height);

        const fresh = performance.now() - frameAtRef.current <= 500;
        const data = fresh ? dataRef.current : null;

        bridge?.drawStickers(ctx, size, data?.faces ?? [], true);
        drawPhotoFrame(ctx, width, height, selectedFrameRef.current);
        drawFeedback(ctx, size, data, overlayStateRef.current);
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [status, videoRef, bridge]);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;

    if (
      status !== "ready" || !video ||
      video.readyState < 2 || video.videoWidth === 0
    ) {
      setFeedback("Camera chưa sẵn sàng.");
      return;
    }

    if (uploadingRef.current) {
      setFeedback("Hãy chờ lưu album xong.");
      return;
    }

    if (countRef.current + reservationsRef.current >= 5) {
      setFeedback("Đã đủ 5 ảnh. Hãy lưu album trước khi chụp tiếp.");
      return;
    }

    bridge?.cancelDrag("Đã hủy sticker chưa dán để chụp ảnh.");

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

    const fresh = performance.now() - frameAtRef.current <= 500;

    bridge?.drawStickers(
      ctx,
      { width: canvas.width, height: canvas.height },
      fresh ? dataRef.current?.faces ?? [] : [],
      false,
    );

    drawPhotoFrame(ctx, canvas.width, canvas.height, selectedFrameRef.current);

    reservationsRef.current += 1;

    canvas.toBlob((blob) => {
      reservationsRef.current -= 1;
      if (!mountedRef.current) return;

      if (!blob) {
        setFeedback("Không thể tạo ảnh. Hãy thử lại.");
        return;
      }

      const file = new File([blob], `photo_${Date.now()}.png`, {
        type: "image/png",
      });

      const previewUrl = URL.createObjectURL(file);
      urlsRef.current.add(previewUrl);
      countRef.current += 1;

      setPhotos((previous) => [...previous, { file, previewUrl }]);
      setFeedback("Đã chụp ảnh có khung và sticker.");
    }, "image/png");
  }, [status, videoRef, bridge]);

  useEffect(() => {
    captureHandlerRef.current = handleCapture;
  }, [handleCapture]);

  async function saveAlbum() {
    if (uploadingRef.current) return;

    if (reservationsRef.current > 0) {
      setFeedback("Ảnh đang được xử lý. Hãy chờ một chút.");
      return;
    }

    if (photos.length === 0) {
      setFeedback("Hãy chụp ít nhất một ảnh.");
      return;
    }

    uploadingRef.current = true;
    setUploading(true);
    setFeedback("Đang lưu album…");

    try {
      const result = await createPhotoSession(photos.map(({ file }) => file));
      if (!mountedRef.current) return;

      if (!result.success) {
        setFeedback(`Lưu thất bại: ${result.error}`);
        return;
      }

      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
      countRef.current = 0;
      setPhotos([]);
      bridge?.clearStickers();
      setFeedback("Đã lưu album thành công.");
      await loadAlbums();
    } catch (saveError) {
      if (mountedRef.current) {
        setFeedback(`Không thể lưu: ${saveError.message || "Hãy thử lại."}`);
      }
    } finally {
      uploadingRef.current = false;
      if (mountedRef.current) setUploading(false);
    }
  }

  return (
    <section className="camera-section">
      <div className="camera-stage" style={{ aspectRatio }}>
        <video ref={videoRef} autoPlay muted playsInline hidden />

        <canvas
          ref={cameraRef}
          className="camera-layer"
          aria-label="Hình ảnh trực tiếp từ webcam"
        />

        <canvas
          ref={overlayRef}
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
                <button type="button" onClick={retryCamera}>Thử lại</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="camera-toolbar">
        <span className="camera-photo-count">{photos.length}/5 ảnh</span>
        <div className="camera-toolbar-buttons">
          <button
            type="button"
            className="primary-button"
            onClick={handleCapture}
            disabled={status !== "ready" || photos.length >= 5 || uploading}
          >
            Chụp ảnh
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={saveAlbum}
            disabled={uploading || photos.length === 0}
          >
            {uploading ? "Đang lưu…" : "Lưu album"}
          </button>
        </div>
      </div>

      <p className="photo-feedback" role="status">
        {feedback || "Giơ chữ V để bắt đầu đếm ngược."}
      </p>

      {status === "ready" && cvStatus === "error" && (
        <div className="cv-error" role="alert">
          <p>Nhận diện chưa hoạt động: {cvError}</p>
          <button type="button" onClick={retryCamera}>Thử lại nhận diện</button>
        </div>
      )}

      {photos.length > 0 && (
        <section className="photo-controls" aria-label="Ảnh chờ lưu">
          <h2>Ảnh vừa chụp</h2>
          <div className="captured-photos">
            {photos.map(({ previewUrl }, index) => (
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
            disabled={loadingAlbums}
            onClick={() => {
              setLoadingAlbums(true);
              setAlbumError("");
              loadAlbums();
            }}
          >
            {loadingAlbums ? "Đang tải…" : "Tải lại"}
          </button>
        </div>

        {albumError && <p role="alert">{albumError}</p>}
        {!albumError && !loadingAlbums && albums.length === 0 && (
          <p>Chưa có album nào.</p>
        )}

        <div className="album-list">
          {albums.map((album) => (
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