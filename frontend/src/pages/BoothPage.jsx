import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraStage from "../components/camera/CameraStage";
import StickerPicker from "../components/stickers/StickerPicker";
import { CvUiContext } from "../components/camera/CvUiContext";
import useStickers from "../hooks/useStickers";
import { FRAMES } from "../data/frames";
import { STICKERS } from "../data/stickers";
import "../styles/stickers.css";
import BoothIcon from "../components/layout/BoothIcon";
import "../styles/booth-icons.css";

const PANELS = [
  { id: "guide", label: "Hướng dẫn" },
  { id: "stickers", label: "Sticker" },
];

const DWELL_DURATION_MS = 700;
const MAX_STABLE_SPEED = 1.4; // px/ms threshold to prevent dwelling during fast hand swipes

export default function BoothPage() {
  const [activePanel, setActivePanel] = useState("guide");
  const [recentPhotos, setRecentPhotos] = useState([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const galleryActionRef = useRef(null);

  const reportPhotos = useCallback((items, openGallery, busy) => {
    setRecentPhotos(items);
    setGalleryBusy(busy);
    galleryActionRef.current = openGallery;
  }, []);

  const [cameraStatus, setCameraStatus] = useState("loading");
  const [cvStatus, setCvStatus] = useState("waiting");
  const [controlMessage, setControlMessage] = useState(
    "Giữ bàn tay mở để nhận quyền điều khiển.",
  );
  const [stickerMessage, setStickerMessage] = useState("");
  const [activeDwellKind, setActiveDwellKind] = useState(null);
  const [selectedSnapKind, setSelectedSnapKind] = useState(null);
  const [scrollState, setScrollState] = useState({
    canUp: false,
    canDown: false,
  });

  const interactionRef = useRef(null);
  const cameraColumnRef = useRef(null);
  const sidebarRef = useRef(null);
  const panelScrollRef = useRef(null);
  const panelBodyRef = useRef(null);
  const cursorRef = useRef(null);
  const latestFrameRef = useRef(null);
  const lastFrameAtRef = useRef(0);
  const hoveredButtonRef = useRef(null);
  const messageRef = useRef("");
  const mousePointRef = useRef(null);

  // Real-time tracking refs for Dwell
  const dwellTargetRef = useRef(null);
  const dwellCooldownUntilRef = useRef(0);
  const lastPointRef = useRef(null);
  const lastPointTimeRef = useRef(0);
  const snapFeedbackTimerRef = useRef(null);

  const {
    ready: stickersReady,
    assetError,
    placements,
    trackingState,
    autoSnapSticker,
    removeSticker,
    clearStickers,
    drawStickers,
    getTrackingStatus,
    validateSnapshotTransforms,
    getDebugInfo,
  } = useStickers();

  const selectedFrame =
    FRAMES.find((item) => item.id === "none") ?? FRAMES[0];

  const getStage = useCallback(
    () => cameraColumnRef.current?.querySelector(".camera-stage"),
    [],
  );

  const getPointerPosition = useCallback((point) => {
    const layout = interactionRef.current;
    const stage = cameraColumnRef.current?.querySelector(".camera-stage");
    const sidebar = sidebarRef.current;

    if (
      !layout ||
      !stage ||
      !sidebar ||
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    ) {
      return null;
    }

    const layoutRect = layout.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();

    const left = Math.max(0, layoutRect.left);
    const right = Math.min(window.innerWidth, layoutRect.right);
    const top = Math.max(0, Math.min(stageRect.top, sidebarRect.top));
    const bottom = Math.min(
      window.innerHeight,
      Math.max(stageRect.bottom, sidebarRect.bottom),
    );

    if (right <= left || bottom <= top) return null;

    return {
      x: left + Math.max(0, Math.min(1, point.x)) * (right - left - 1),
      y: top + Math.max(0, Math.min(1, point.y)) * (bottom - top - 1),
    };
  }, []);

  /**
   * Generous hit-testing: allows comfortable selection at ~1m distance.
   */
  const findButtonAt = useCallback((point) => {
    if (!point || !interactionRef.current) return null;

    // 1. Direct hit
    const direct = document.elementFromPoint(point.x, point.y)?.closest("button");
    if (
      direct &&
      !direct.disabled &&
      direct.closest("[data-cv-selectable]") &&
      interactionRef.current.contains(direct)
    ) {
      return direct;
    }

    // 2. Proximity hit test with 18px boundary expansion for ~1m interaction
    const buttons = interactionRef.current.querySelectorAll(
      "[data-cv-selectable] button:not(:disabled), button[data-cv-selectable]:not(:disabled)",
    );
    const HIT_MARGIN = 18;
    let bestButton = null;
    let minDistance = Infinity;

    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      if (
        point.x >= rect.left - HIT_MARGIN &&
        point.x <= rect.right + HIT_MARGIN &&
        point.y >= rect.top - HIT_MARGIN &&
        point.y <= rect.bottom + HIT_MARGIN
      ) {
        const cx = (rect.left + rect.right) / 2;
        const cy = (rect.top + rect.bottom) / 2;
        const d = Math.hypot(point.x - cx, point.y - cy);
        if (d < minDistance) {
          minDistance = d;
          bestButton = btn;
        }
      }
    }

    return bestButton;
  }, []);

  const resetDwell = useCallback(() => {
    if (dwellTargetRef.current?.button) {
      dwellTargetRef.current.button.style.setProperty("--dwell-progress", "0");
      dwellTargetRef.current.button.classList.remove("is-dwelling");
    }
    dwellTargetRef.current = null;
    setActiveDwellKind(null);
    if (cursorRef.current) {
      cursorRef.current.classList.remove("is-dwelling");
    }
  }, []);

  const resetInteraction = useCallback((message = "") => {
    resetDwell();
    if (message) setStickerMessage(message);
  }, [resetDwell]);

  const reportStatus = useCallback((camera, cv) => {
    setCameraStatus(camera);
    setCvStatus(cv);
  }, []);

  const reportFrame = useCallback(
    (data) => {
      latestFrameRef.current = data;
      lastFrameAtRef.current = performance.now();

      let message = "Giữ bàn tay mở để nhận quyền điều khiển.";

      if (data.controller.kind === "arming") {
        message = `Đang nhận quyền: ${Math.round(data.controller.progress * 100)}%`;
      } else if (data.controller.kind === "locked") {
        if (data.pointing) {
          message = "Đang trỏ ngón tay — giữ yên 0.7s để tự động chọn.";
        } else {
          message = "Đã nhận quyền — giơ ngón trỏ để trỏ vào sticker.";
        }
      }

      if (messageRef.current !== message) {
        messageRef.current = message;
        setControlMessage(message);
      }
    },
    [],
  );

  const resetCv = useCallback(() => {
    latestFrameRef.current = null;
    lastFrameAtRef.current = 0;
    messageRef.current = "";
    setControlMessage("Giữ bàn tay mở để nhận quyền điều khiển.");
    resetDwell();

    if (cursorRef.current) cursorRef.current.hidden = true;
    hoveredButtonRef.current?.classList.remove("cv-hover");
    hoveredButtonRef.current = null;
  }, [resetDwell]);

  // Height sync for layout
  useEffect(() => {
    const stage = getStage();
    const sidebar = sidebarRef.current;
    if (!stage || !sidebar) return;

    function syncHeight() {
      sidebar.style.setProperty(
        "--camera-height",
        `${stage.getBoundingClientRect().height}px`,
      );
    }

    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [getStage]);

  // Sidebar scroll state
  const updateScrollState = useCallback(() => {
    const area = panelScrollRef.current;
    if (!area) return;

    const next = {
      canUp: area.scrollTop > 2,
      canDown: area.scrollTop + area.clientHeight < area.scrollHeight - 2,
    };

    setScrollState((previous) =>
      previous.canUp === next.canUp && previous.canDown === next.canDown
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    const area = panelScrollRef.current;
    const body = panelBodyRef.current;
    if (!area || !body) return;

    area.scrollTop = 0;
    updateScrollState();

    const observer = new ResizeObserver(updateScrollState);
    observer.observe(area);
    observer.observe(body);
    return () => observer.disconnect();
  }, [activePanel, updateScrollState]);

  function scrollPanel(direction) {
    const area = panelScrollRef.current;
    if (!area) return;

    area.scrollBy({
      top: direction * Math.max(100, area.clientHeight * 0.7),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  // Mouse selection support
  const handleStickerPick = useCallback(
    (kind) => {
      const data = latestFrameRef.current;
      const stage = getStage();
      const faces = data?.faces ?? [];

      const result = autoSnapSticker(kind, faces, mousePointRef.current, stage);
      if (result.success) {
        const stickerName =
          STICKERS.find((item) => item.id === kind)?.name ?? kind;
        setStickerMessage(`Đã dán ${stickerName} lên mặt #${result.faceId}.`);
        setSelectedSnapKind(kind);
        window.clearTimeout(snapFeedbackTimerRef.current);
        snapFeedbackTimerRef.current = window.setTimeout(() => {
          setSelectedSnapKind(null);
        }, 1500);
      } else {
        setStickerMessage(
          "Không tìm thấy khuôn mặt phù hợp. Hãy đứng trước camera.",
        );
      }
    },
    [autoSnapSticker, getStage],
  );

  useEffect(() => {
    function onMove(event) {
      mousePointRef.current = { x: event.clientX, y: event.clientY };
    }

    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.clearTimeout(snapFeedbackTimerRef.current);
    };
  }, []);

  /**
   * Main interaction loop:
   * Pointing Detection -> Stable Velocity Check -> 700ms Dwell Progress -> Smart Snap-to-Face.
   */
  useEffect(() => {
    let animationId;

    function draw() {
      const data = latestFrameRef.current;
      const now = performance.now();
      const fresh = now - lastFrameAtRef.current <= 500;

      const isLocked = fresh && data?.controller.kind === "locked";
      const isPointing = isLocked && Boolean(data?.pointing);

      const point =
        isLocked && data?.cursor ? getPointerPosition(data.cursor) : null;

      // Update cursor position & visual styling
      if (cursorRef.current) {
        cursorRef.current.hidden = !point;

        if (point) {
          cursorRef.current.style.left = `${point.x}px`;
          cursorRef.current.style.top = `${point.y}px`;
          cursorRef.current.classList.toggle("is-pointing", isPointing);
        }
      }

      // Hit test target button
      const button = point ? findButtonAt(point) : null;

      // Update button hover highlight
      if (button !== hoveredButtonRef.current) {
        hoveredButtonRef.current?.classList.remove("cv-hover");
        button?.classList.add("cv-hover");
        hoveredButtonRef.current = button;
      }

      // Check velocity / speed stability
      let speed = 0;
      if (point && lastPointRef.current) {
        const distMoved = Math.hypot(
          point.x - lastPointRef.current.x,
          point.y - lastPointRef.current.y,
        );
        const dt = Math.max(1, now - lastPointTimeRef.current);
        speed = distMoved / dt;
      }
      if (point) {
        lastPointRef.current = point;
        lastPointTimeRef.current = now;
      } else {
        lastPointRef.current = null;
      }

      // Dwell interaction processing
      const inCooldown = now < dwellCooldownUntilRef.current;
      const canDwell =
        isLocked &&
        button &&
        !inCooldown &&
        (isPointing || speed < 0.6); // Pointing gesture or steady hover

      if (canDwell) {
        const isSameTarget = dwellTargetRef.current?.button === button;

        if (!isSameTarget) {
          // Switch to new target
          if (dwellTargetRef.current?.button) {
            dwellTargetRef.current.button.style.setProperty("--dwell-progress", "0");
            dwellTargetRef.current.button.classList.remove("is-dwelling");
          }

          dwellTargetRef.current = {
            button,
            kind: button.dataset.stickerKind || null,
            startTime: now,
          };

          if (button.dataset.stickerKind) {
            setActiveDwellKind(button.dataset.stickerKind);
          }
        }

        const dwell = dwellTargetRef.current;
        if (dwell) {
          // If moving too quickly, pause/reset dwell progress
          if (speed > MAX_STABLE_SPEED) {
            dwell.startTime = now;
          }

          const elapsed = now - dwell.startTime;
          const progress = Math.min(1, elapsed / DWELL_DURATION_MS);

          // Update progress ring directly on DOM for 60fps performance
          button.style.setProperty("--dwell-progress", progress.toFixed(3));
          button.classList.toggle("is-dwelling", progress > 0.05);
          cursorRef.current?.classList.toggle("is-dwelling", progress > 0.05);

          // Dwell completed: 700ms held!
          if (progress >= 1) {
            button.style.setProperty("--dwell-progress", "0");
            button.classList.remove("is-dwelling");
            cursorRef.current?.classList.remove("is-dwelling");

            dwellCooldownUntilRef.current = now + 900;
            dwellTargetRef.current = null;
            setActiveDwellKind(null);

            if (dwell.kind) {
              // Smart Snap-to-Face!
              const stage = getStage();
              const faces = data?.faces ?? [];
              const result = autoSnapSticker(dwell.kind, faces, point, stage);

              if (result.success) {
                const stickerName =
                  STICKERS.find((item) => item.id === dwell.kind)?.name ??
                  dwell.kind;
                setStickerMessage(
                  `Đã gắn ${stickerName} lên mặt #${result.faceId}!`,
                );
                setSelectedSnapKind(dwell.kind);

                window.clearTimeout(snapFeedbackTimerRef.current);
                snapFeedbackTimerRef.current = window.setTimeout(() => {
                  setSelectedSnapKind(null);
                }, 1500);
              } else {
                setStickerMessage(
                  "Không tìm thấy khuôn mặt phù hợp. Hãy đứng trước camera.",
                );
              }
            } else {
              // Regular UI button dwell activation
              button.click();
            }
          }
        }
      } else {
        // Not dwelling on any button
        if (dwellTargetRef.current) {
          resetDwell();
        }
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      hoveredButtonRef.current?.classList.remove("cv-hover");
      resetDwell();
    };
  }, [
    autoSnapSticker,
    findButtonAt,
    getPointerPosition,
    getStage,
    resetDwell,
  ]);

  const cvBridge = useMemo(
    () => ({
      reportFrame,
      reportStatus,
      resetCv,
      resetInteraction,
      drawStickers,
      clearStickers,
      reportPhotos,
      getTrackingStatus,
      validateSnapshotTransforms,
      getDebugInfo,
    }),
    [
      reportFrame,
      reportStatus,
      resetCv,
      resetInteraction,
      drawStickers,
      clearStickers,
      reportPhotos,
      getTrackingStatus,
      validateSnapshotTransforms,
      getDebugInfo,
    ],
  );

  const ready = cameraStatus === "ready" && cvStatus === "ready";

  const statusLabel =
    cameraStatus !== "ready"
      ? cameraStatus === "error"
        ? "Camera cần kiểm tra"
        : "Đang mở camera"
      : cvStatus === "ready"
        ? "Camera và nhận diện sẵn sàng"
        : cvStatus === "error"
          ? "Nhận diện cần kiểm tra"
          : "Đang tải nhận diện";

  return (
    <CvUiContext.Provider value={cvBridge}>
      <main className="app-shell">
        <header className="app-header">
          <div className="brand">
            <h1>SpaceBooth</h1>
            <span>Chụp ảnh không chạm</span>
          </div>
          <p className={`system-status ${ready ? "is-ready" : ""}`}>
            <span className="status-dot" aria-hidden="true" />
            {statusLabel}
          </p>
        </header>

        <div className="interaction-hint" role="status">
          {ready
            ? stickerMessage ||
              (placements.length > 0 && trackingState === "TEMPORARY_HOLD"
                ? "Đang giữ vị trí sticker..."
                : placements.length > 0 && trackingState === "TRACKING_LOST"
                  ? "Không nhận diện được khuôn mặt. Hãy nhìn về phía camera."
                  : controlMessage)
            : "Có thể dùng chuột để chọn công cụ."}
        </div>

        <div ref={interactionRef} className="booth-layout">
          <div ref={cameraColumnRef} className="camera-column">
            <CameraStage frame={selectedFrame} />
          </div>

          <aside ref={sidebarRef} className="booth-sidebar">
            <section className="control-panel" aria-label="Bảng công cụ">
              <nav
                className="panel-switcher"
                aria-label="Công cụ chụp ảnh"
                data-cv-selectable
              >
                {PANELS.map((panel) => (
                  <button
                    key={panel.id}
                    type="button"
                    className="panel-button"
                    aria-pressed={activePanel === panel.id}
                    onClick={() => {
                      resetDwell();
                      setActivePanel(panel.id);
                    }}
                  >
                    {panel.label}
                  </button>
                ))}
              </nav>

              <div
                ref={panelScrollRef}
                className="panel-scroll"
                onScroll={updateScrollState}
                tabIndex={0}
                role="region"
                aria-label={
                  PANELS.find((item) => item.id === activePanel)?.label
                }
              >
                <div ref={panelBodyRef} className="panel-content">
                  {activePanel === "guide" && (
                    <>
                      <h2>Cách sử dụng</h2>
                      <ol className="instructions">
                        <li>Giữ bàn tay mở để nhận quyền điều khiển.</li>
                        <li>Giơ ngón trỏ để trỏ vào sticker hoặc nút.</li>
                        <li>Giữ yên ngón trỏ trong 0.7s để chọn.</li>
                        <li>Sticker tự động dán lên khuôn mặt của bạn!</li>
                        <li>Giơ chữ V để đếm ngược chụp ảnh.</li>
                      </ol>
                    </>
                  )}

                  {activePanel === "stickers" && (
                    <StickerPicker
                      ready={stickersReady}
                      error={assetError}
                      placements={placements}
                      activeKind={activeDwellKind}
                      selectedKind={selectedSnapKind}
                      onPick={handleStickerPick}
                      onRemove={removeSticker}
                      onClear={clearStickers}
                    />
                  )}
                </div>
              </div>

              <div className="panel-scroll-controls" data-cv-selectable>
                <button
                  type="button"
                  className="scroll-button"
                  aria-label="Cuộn lên"
                  disabled={!scrollState.canUp}
                  onClick={() => scrollPanel(-1)}
                >
                  <BoothIcon direction="up" />
                </button>
                <button
                  type="button"
                  className="scroll-button"
                  aria-label="Cuộn xuống"
                  disabled={!scrollState.canDown}
                  onClick={() => scrollPanel(1)}
                >
                  <BoothIcon direction="down" />
                </button>
              </div>
            </section>

            <section className="photo-panel">
              <div className="photo-panel-heading">
                <h2>Ảnh vừa chụp</h2>
                <span>{recentPhotos.length}/5</span>
              </div>

              {recentPhotos.length > 0 ? (
                <button
                  type="button"
                  className="recent-photo-button"
                  disabled={galleryBusy}
                  onClick={() => galleryActionRef.current?.()}
                  aria-label={`Xem ${recentPhotos.length} ảnh vừa chụp`}
                  data-cv-selectable
                >
                  <img
                    src={recentPhotos[recentPhotos.length - 1].previewUrl}
                    alt="Ảnh chụp gần nhất"
                  />
                  <span className="recent-photo-open" aria-hidden="true">
                    <BoothIcon direction="right" />
                  </span>
                </button>
              ) : (
                <p className="recent-photo-empty">
                  Chưa có ảnh trong lượt này.
                </p>
              )}
            </section>
          </aside>
        </div>

        <div
          ref={cursorRef}
          className="cv-ui-cursor"
          aria-hidden="true"
          hidden
        />
      </main>
    </CvUiContext.Provider>
  );
}
