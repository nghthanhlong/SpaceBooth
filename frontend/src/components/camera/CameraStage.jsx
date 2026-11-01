import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { CvEngine, DEFAULT_ENGINE } from "spacebooth-cv";
import useWebcam from "../../hooks/useWebcam";
import useCountdownAudio from "../../hooks/useCountdownAudio";
import { createPhotoSession, getPhotoSessions } from "../../firebase";
import { CvUiContext } from "./CvUiContext";
import CountdownOverlay from "./CountdownOverlay";
import CaptureScreen from "./CaptureScreen";
import QRDisplay from "./QRDisplay";
import "../../styles/capture.css";

const COUNTDOWN_MS = 10_000;
const MAX_PHOTOS = 5;

function drawPhotoFrame(ctx, size, frame) {
  if (!frame?.color) return;

  ctx.save();
  ctx.strokeStyle = frame.color;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, size.width - 10, size.height - 10);
  ctx.restore();
}

function drawArming(ctx, size, data, captureProgress) {
  ctx.save();

  if (data?.controller.kind === "arming") {
    const hand = data.hands.find(
      (item) => item.id === data.controller.handId,
    );
    const wrist = hand?.landmarks[0];

    if (wrist) {
      ctx.beginPath();
      ctx.arc(
        wrist.x * size.width,
        wrist.y * size.height,
        28,
        -Math.PI / 2,
        -Math.PI / 2 + data.controller.progress * Math.PI * 2,
      );
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }

  if (captureProgress > 0) {
    ctx.fillStyle = "rgba(15,23,42,.85)";
    ctx.fillRect(12, 12, size.width - 24, 42);
    ctx.fillStyle = "#ffffff";
    ctx.font = "18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `Giữ chữ V: ${Math.round(captureProgress * 100)}%`,
      size.width / 2,
      33,
      size.width - 48,
    );
  }

  ctx.restore();
}

function formatSessionDate(timestamp) {
  const date =
    timestamp?.toDate?.() ?? (timestamp ? new Date(timestamp) : null);

  if (!date || Number.isNaN(date.getTime())) return "Chưa có thời gian";

  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function CameraStage({ frame }) {
  const bridge = useContext(CvUiContext);
  const audio = useCountdownAudio();

  const rootRef = useRef(null);
  const cameraRef = useRef(null);
  const overlayRef = useRef(null);
  const frameRef = useRef(frame);
  const dataRef = useRef(null);
  const frameAtRef = useRef(0);
  const progressRef = useRef(0);
  const mountedRef = useRef(false);
  const phaseRef = useRef("live");
  const deadlineRef = useRef(0);
  const lastSecondRef = useRef(null);
  const snapshotRef = useRef(() => {});
  const countdownRequestRef = useRef(() => {});
  const photosRef = useRef([]);
  const urlsRef = useRef(new Set());
  const savingRef = useRef(false);
  const flashTimerRef = useRef(null);

  const [aspectRatio, setAspectRatio] = useState("16 / 9");
  const [phase, setPhase] = useState("live");
  const [seconds, setSeconds] = useState(null);
  const [flash, setFlash] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [feedback, setFeedback] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [cvStatus, setCvStatus] = useState("waiting");
  const [cvError, setCvError] = useState("");
  const [albums, setAlbums] = useState([]);
  const [albumError, setAlbumError] = useState("");
  const [loadingAlbums, setLoadingAlbums] = useState(true);
  const [reviewHost, setReviewHost] = useState(null);
  const [reviewHeight, setReviewHeight] = useState(480);
  const [savedSession, setSavedSession] = useState(null);

  const { videoRef, status, error, retry } = useWebcam();

  const { playTick, playCapture } = audio;

  const changePhase = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const updatePhotos = useCallback((next) => {
    photosRef.current = next;
    setPhotos(next);
  }, []);

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  useEffect(() => {
    bridge?.reportStatus(status, cvStatus);
  }, [bridge, status, cvStatus]);

  useEffect(() => {
    const urls = urlsRef.current;
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      window.clearTimeout(flashTimerRef.current);
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const stage = root?.querySelector(".camera-stage");

    if (!root || !stage) return;

    setReviewHost(root.closest(".booth-layout"));

    function measure() {
      setReviewHeight(stage.getBoundingClientRect().height);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);

    return () => observer.disconnect();
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
        if (active) {
          setAlbumError(loadError.message || "Không thể tải album.");
        }
      })
      .finally(() => {
        if (active) setLoadingAlbums(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const startCountdown = useCallback(() => {
    if (phaseRef.current !== "live" || savingRef.current) return;

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

    if (photosRef.current.length >= MAX_PHOTOS) {
      setFeedback("Đã đủ 5 ảnh. Hãy xem và lưu ảnh trước.");
      return;
    }

    bridge?.cancelDrag("Đang chụp, đã hủy sticker chưa dán.");
    progressRef.current = 0;
    lastSecondRef.current = 10;
    deadlineRef.current = performance.now() + COUNTDOWN_MS;

    setFeedback("");
    setSeconds(10);
    changePhase("countdown");
    playTick(10);
  }, [status, videoRef, bridge, changePhase, playTick]);

  useEffect(() => {
    countdownRequestRef.current = startCountdown;
  }, [startCountdown]);

  const takeSnapshot = useCallback(() => {
    if (phaseRef.current !== "countdown") return;

    changePhase("capturing");
    setSeconds(null);

    const video = videoRef.current;

    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      setFeedback("Camera bị gián đoạn. Hãy thử chụp lại.");
      changePhase("live");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      setFeedback("Không thể tạo ảnh.");
      changePhase("live");
      return;
    }

    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const size = { width: canvas.width, height: canvas.height };
    const fresh = performance.now() - frameAtRef.current <= 500;

    bridge?.drawStickers(
      ctx,
      size,
      fresh ? dataRef.current?.faces ?? [] : [],
      false,
    );

    drawPhotoFrame(ctx, size, frameRef.current);

    playCapture();
    setFlash(true);

    window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setFlash(false);
    }, 350);

    canvas.toBlob((blob) => {
      if (!mountedRef.current) return;

      if (!blob) {
        setFeedback("Không tạo được ảnh. Hãy thử lại.");
        changePhase("live");
        return;
      }

      const id = crypto.randomUUID();

      const file = new File([blob], `spacebooth_${id}.png`, {
        type: "image/png",
      });

      const previewUrl = URL.createObjectURL(file);
      urlsRef.current.add(previewUrl);

      updatePhotos([
        ...photosRef.current,
        { id, file, previewUrl },
      ]);

      setReviewMessage("");
      setFeedback("Đã chụp ảnh. Bấm ô Ảnh vừa chụp để xem.");
      changePhase("live");
    }, "image/png");
  }, [
    bridge,
    videoRef,
    changePhase,
    playCapture,
    updatePhotos,
  ]);

  useEffect(() => {
    snapshotRef.current = takeSnapshot;
  }, [takeSnapshot]);

  // Chỉ một đồng hồ UI quyết định thời điểm tạo ảnh.
  useEffect(() => {
    if (phase !== "countdown") return;

    let animationId;

    function tick() {
      const remaining = Math.max(
        0,
        Math.ceil((deadlineRef.current - performance.now()) / 1000),
      );

      if (remaining <= 0) {
        snapshotRef.current();
        return;
      }

      if (remaining !== lastSecondRef.current) {
        lastSecondRef.current = remaining;
        setSeconds(remaining);
        playTick(remaining);
      }

      animationId = requestAnimationFrame(tick);
    }

    tick();

    return () => cancelAnimationFrame(animationId);
  }, [phase, playTick]);

  useEffect(() => {
    if (status !== "ready") return;

    let active = true;

    const engine = new CvEngine(videoRef.current, {
      controller: {
        ...DEFAULT_ENGINE.controller,
        countdownMs: COUNTDOWN_MS,
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
        if (
          active &&
          (["live", "review", "qr"].includes(phaseRef.current) && !savingRef.current)
        ) {
          bridge?.handlePinchStart(point);
        }
      }),

      engine.on("pinchEnd", (point) => {
        if (active) bridge?.handlePinchEnd(point);
      }),

      engine.on("release", () => {
        if (active) {
          bridge?.cancelDrag("Mất quyền điều khiển, đã hủy kéo sticker.");
        }
      }),

      engine.on("captureProgress", ({ progress }) => {
        if (active && phaseRef.current === "live") {
          progressRef.current = progress;
        }
      }),

      engine.on("countdownStart", () => {
        if (active && phaseRef.current === "live") {
          countdownRequestRef.current();
        }
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
      progressRef.current = 0;
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

        bridge?.drawStickers(
          ctx,
          size,
          data?.faces ?? [],
          phaseRef.current === "live",
        );

        drawPhotoFrame(ctx, size, frameRef.current);

        if (phaseRef.current === "live") {
          drawArming(ctx, size, data, progressRef.current);
        }
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [status, videoRef, bridge]);

  function retryCamera() {
    if (phaseRef.current === "countdown") {
      changePhase("live");
      setSeconds(null);
    }

    setCvStatus("waiting");
    setCvError("");
    retry();
  }

  const openReview = useCallback(() => {
    if (phaseRef.current !== "live" || photosRef.current.length === 0) return;

    bridge?.cancelDrag();
    setReviewMessage("");
    changePhase("review");
  }, [bridge, changePhase]);

  function backToCamera() {
    if (savingRef.current) return;
    setReviewMessage("");
    changePhase("live");
  }

  async function saveSelectedPhotos(selectedIds) {
    if (savingRef.current || phaseRef.current !== "review") return;

    const selected = photosRef.current.filter(
      (photo) => selectedIds.includes(photo.id),
    );

    if (selected.length === 0) {
      setReviewMessage("Hãy chọn ít nhất một ảnh.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setReviewMessage("Đang lưu ảnh đã chọn…");

    try {
      const result = await createPhotoSession(
        selected.map((photo) => photo.file),
      );

      if (!mountedRef.current) return;

      if (!result.success) {
        setReviewMessage(`Lưu thất bại: ${result.error}`);
        return;
      }

      const savedIds = new Set(selected.map((photo) => photo.id));
      const remaining = photosRef.current.filter(
        (photo) => !savedIds.has(photo.id),
      );

      // Chỉ giải phóng những ảnh đã lưu thành công.
      selected.forEach((photo) => {
        URL.revokeObjectURL(photo.previewUrl);
        urlsRef.current.delete(photo.previewUrl);
      });

      updatePhotos(remaining);

      if (remaining.length === 0) {
        bridge?.clearStickers();
      }

      setFeedback(
        `Đã lưu ${selected.length} ảnh. ${
          remaining.length > 0
            ? `Còn ${remaining.length} ảnh chưa lưu.`
            : "Có thể bắt đầu lượt chụp mới."
        }`,
      );

      const downloadableUrls = (result.urls ?? []).filter((url) => {
        try {
          return new URL(url).protocol === "https:";
        } catch {
          return false;
        }
      });

      if (downloadableUrls.length > 0) {
        setSavedSession({
          sessionId: result.sessionId,
          urls: downloadableUrls,
        });
        setReviewMessage("");
        bridge?.cancelDrag();
        changePhase("qr");
      } else if (remaining.length === 0) {
        changePhase("live");
        setFeedback("Đã lưu ảnh nhưng chưa nhận được liên kết QR. Kiểm tra Album đã lưu.");
      } else {
        setReviewMessage("Đã lưu ảnh nhưng chưa nhận được liên kết QR. Kiểm tra Album đã lưu.");
      }

      await loadAlbums();
    } catch (saveError) {
      if (mountedRef.current) {
        setReviewMessage(
          `Không thể lưu ảnh: ${saveError.message || "Hãy thử lại."}`,
        );
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  function closeQr() {
    if (savingRef.current) return;

    setSavedSession(null);
    setReviewMessage("");
    changePhase(photosRef.current.length > 0 ? "review" : "live");
  }

  function discardPhoto(id) {
    if (savingRef.current || phaseRef.current !== "review") return;

    const discarded = photosRef.current.find((photo) => photo.id === id);
    if (!discarded) return;

    const remaining = photosRef.current.filter((photo) => photo.id !== id);

    URL.revokeObjectURL(discarded.previewUrl);
    urlsRef.current.delete(discarded.previewUrl);
    updatePhotos(remaining);

    if (remaining.length === 0) {
      setFeedback("Đã bỏ ảnh cuối cùng của lượt hiện tại.");
      changePhase("live");
    } else {
      setReviewMessage("Đã bỏ ảnh khỏi lượt hiện tại.");
    }
  }

  useEffect(() => {
    bridge?.reportPhotos?.(
      photos,
      openReview,
      phase !== "live" || saving,
    );
  }, [photos, openReview, phase, saving, bridge]);

  return (
    <section ref={rootRef} className="camera-section">
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

        <CountdownOverlay seconds={seconds} />

        {flash && <div className="capture-flash" aria-hidden="true" />}

        {status !== "ready" && (
          <div className="camera-message">
            {status === "loading" ? (
              <p>Hãy cho phép trình duyệt sử dụng camera.</p>
            ) : (
              <>
                <p role="alert">{error}</p>
                <button type="button" onClick={retryCamera}>
                  Thử lại
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="camera-toolbar">
        <span className="camera-photo-count">
          {photos.length}/{MAX_PHOTOS} ảnh
        </span>

        <div className="camera-toolbar-buttons">
          <button
            type="button"
            className="audio-button"
            onClick={audio.toggle}
            aria-pressed={audio.enabled}
            disabled={phase === "countdown" || phase === "capturing"}
          >
            {audio.enabled ? "Âm thanh: Bật" : "Bật âm thanh"}
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={startCountdown}
            disabled={
              status !== "ready" ||
              phase !== "live" ||
              photos.length >= MAX_PHOTOS ||
              saving
            }
          >
            {phase === "countdown" ? "Đang đếm ngược…" : "Chụp ảnh"}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={openReview}
            disabled={photos.length === 0 || phase !== "live"}
          >
            Xem ảnh ({photos.length})
          </button>
        </div>
      </div>

      <p className="photo-feedback" role="status">
        {audio.error ||
          feedback ||
          "Bật âm thanh một lần, sau đó giơ chữ V để chụp."}
      </p>

      {status === "ready" && cvStatus === "error" && (
        <div className="cv-error" role="alert">
          <p>Nhận diện chưa hoạt động: {cvError}</p>
          <button type="button" onClick={retryCamera}>
            Thử lại nhận diện
          </button>
        </div>
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
                      <img
                        src={url}
                        alt={`Ảnh ${index + 1} trong album`}
                      />
                    </a>
                  ),
                )}
              </div>
            </article>
          ))}
        </div>
      </details>

      {phase === "review" && photos.length > 0 && (
        <CaptureScreen
          host={reviewHost}
          height={reviewHeight}
          photos={photos}
          saving={saving}
          message={reviewMessage}
          onBack={backToCamera}
          onSave={saveSelectedPhotos}
          onDiscard={discardPhoto}
        />
      )}
      {phase === "qr" && savedSession && (
        <QRDisplay
          key={savedSession.sessionId}
          host={reviewHost}
          height={reviewHeight}
          session={savedSession}
          remainingCount={photos.length}
          onBack={closeQr}
        />
      )}
    </section>
  );
}