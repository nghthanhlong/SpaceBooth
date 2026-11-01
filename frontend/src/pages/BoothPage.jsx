import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraStage from "../components/camera/CameraStage";
import FramePicker from "../components/frames/FramePicker";
import StickerPicker from "../components/stickers/StickerPicker";
import { CvUiContext } from "../components/camera/CvUiContext";
import useStickers from "../hooks/useStickers";
import { FRAMES } from "../data/frames";
import { STICKERS } from "../data/stickers";
import "../styles/stickers.css";

const PANELS = [
  { id: "guide", label: "Hướng dẫn" },
  { id: "frames", label: "Khung" },
  { id: "stickers", label: "Sticker" },
];

export default function BoothPage() {
  const [activePanel, setActivePanel] = useState("frames");
  const [selectedFrameId, setSelectedFrameId] = useState("none");
  const [cameraStatus, setCameraStatus] = useState("loading");
  const [cvStatus, setCvStatus] = useState("waiting");
  const [controlMessage, setControlMessage] = useState(
    "Giữ bàn tay mở để nhận quyền điều khiển.",
  );
  const [stickerMessage, setStickerMessage] = useState("");
  const [draggedKind, setDraggedKind] = useState(null);
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
  const dragImageRef = useRef(null);
  const latestFrameRef = useRef(null);
  const lastFrameAtRef = useRef(0);
  const hoveredButtonRef = useRef(null);
  const messageRef = useRef("");
  const dragRef = useRef(null);
  const pendingDropRef = useRef(null);
  const mousePointRef = useRef(null);

  const {
    ready: stickersReady,
    assetError,
    placements,
    findTarget,
    commitTarget,
    clearTarget,
    removeSticker,
    clearStickers,
    drawStickers,
  } = useStickers();

  const selectedFrame =
    FRAMES.find((item) => item.id === selectedFrameId) ?? FRAMES[0];

  const getStage = useCallback(
    () => cameraColumnRef.current?.querySelector(".camera-stage"),
    [],
  );

  const getPointerPosition = useCallback((point) => {
    const layout = interactionRef.current;
    const stage = cameraColumnRef.current?.querySelector(".camera-stage");
    const sidebar = sidebarRef.current;

    if (
      !layout || !stage || !sidebar || !point ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y)
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

  const findButtonAt = useCallback((point) => {
    if (!point) return null;

    const button = document.elementFromPoint(point.x, point.y)?.closest("button");

    if (
      !button || button.disabled ||
      !button.closest("[data-cv-selectable]") ||
      !interactionRef.current?.contains(button)
    ) {
      return null;
    }

    return button;
  }, []);

  const finishDrag = useCallback(() => {
    dragRef.current = null;
    pendingDropRef.current = null;
    clearTarget();
    setDraggedKind(null);
  }, [clearTarget]);

  const cancelDrag = useCallback((message = "Đã hủy kéo sticker.") => {
    if (dragRef.current) setStickerMessage(message);
    finishDrag();
  }, [finishDrag]);

  const startDrag = useCallback((kind, source, handId = null) => {
    if (!stickersReady) return;

    dragRef.current = { kind, source, handId };
    pendingDropRef.current = null;
    clearTarget();
    setDraggedKind(kind);
    setStickerMessage(
      source === "cv"
        ? "Đưa sticker tới mặt có viền xanh rồi mở tay."
        : "Di chuột tới mặt có viền xanh rồi bấm để dán.",
    );
  }, [clearTarget, stickersReady]);

  const dropAt = useCallback((point, data) => {
    const drag = dragRef.current;
    if (!drag || !point || !data) {
      cancelDrag();
      return;
    }

    const target = findTarget(point, drag.kind, getStage(), data);

    if (commitTarget(target, drag.kind)) {
      setStickerMessage(`Đã dán sticker lên mặt #${target.face.id}.`);
      finishDrag();
    } else {
      cancelDrag("Không có mặt hợp lệ ở vị trí thả. Đã hủy kéo.");
    }
  }, [cancelDrag, commitTarget, findTarget, finishDrag, getStage]);

  const reportStatus = useCallback((camera, cv) => {
    setCameraStatus(camera);
    setCvStatus(cv);
  }, []);

  const reportFrame = useCallback((data) => {
    latestFrameRef.current = data;
    lastFrameAtRef.current = performance.now();

    const drag = dragRef.current;

    if (drag?.source === "cv") {
      const sameController =
        data.controller.kind === "locked" &&
        data.controller.handId === drag.handId &&
        data.hands.some((hand) => hand.id === drag.handId);

      if (!sameController) {
        cancelDrag("Mất quyền hoặc mất dấu tay. Đã hủy kéo sticker.");
      } else if (pendingDropRef.current) {
        const pending = pendingDropRef.current;

        // Xác nhận bằng frame mới để tránh coi mất tay là thả chủ động.
        if (
          !data.pinching &&
          performance.now() - pending.at < 500
        ) {
          dropAt(getPointerPosition(pending.point), data);
        } else if (performance.now() - pending.at >= 500) {
          cancelDrag();
        }
      }
    }

    let message = "Giữ bàn tay mở để nhận quyền điều khiển.";

    if (data.controller.kind === "arming") {
      message = `Đang nhận quyền: ${Math.round(data.controller.progress * 100)}%`;
    } else if (data.controller.kind === "locked") {
      message = data.pinching
        ? "Đang chụm ngón — mở tay để thả hoặc chọn tiếp."
        : "Đã nhận quyền — trỏ tới lựa chọn rồi chụm ngón.";
    }

    if (messageRef.current !== message) {
      messageRef.current = message;
      setControlMessage(message);
    }
  }, [cancelDrag, dropAt, getPointerPosition]);

  const handlePinchStart = useCallback((point) => {
    const data = latestFrameRef.current;

    if (
      data?.controller.kind !== "locked" ||
      performance.now() - lastFrameAtRef.current > 500 ||
      dragRef.current
    ) {
      return;
    }

    const button = findButtonAt(getPointerPosition(point));
    if (!button) return;

    if (button.dataset.stickerKind) {
      startDrag(button.dataset.stickerKind, "cv", data.controller.handId);
    } else {
      button.click();
    }
  }, [findButtonAt, getPointerPosition, startDrag]);

  const handlePinchEnd = useCallback((point) => {
    if (dragRef.current?.source === "cv") {
      pendingDropRef.current = { point, at: performance.now() };
    }
  }, []);

  const resetCv = useCallback(() => {
    latestFrameRef.current = null;
    lastFrameAtRef.current = 0;
    messageRef.current = "";
    setControlMessage("Giữ bàn tay mở để nhận quyền điều khiển.");
    cancelDrag();

    if (cursorRef.current) cursorRef.current.hidden = true;
    hoveredButtonRef.current?.classList.remove("cv-hover");
    hoveredButtonRef.current = null;
  }, [cancelDrag]);

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

  // Dự phòng bằng chuột và phím Escape.
  useEffect(() => {
    function onMove(event) {
      mousePointRef.current = { x: event.clientX, y: event.clientY };
    }

    function onClick(event) {
      if (dragRef.current?.source !== "mouse") return;

      const stage = getStage();

      if (stage?.contains(event.target)) {
        if (performance.now() - lastFrameAtRef.current > 500) {
          cancelDrag("Chưa có dữ liệu mặt mới. Hãy thử lại.");
          return;
        }

        dropAt(
          { x: event.clientX, y: event.clientY },
          latestFrameRef.current,
        );
      }
    }

    function onKey(event) {
      if (event.key === "Escape") cancelDrag();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [cancelDrag, dropAt, getStage]);

  useEffect(() => {
    let animationId;

    function draw() {
      const data = latestFrameRef.current;
      const fresh = performance.now() - lastFrameAtRef.current <= 500;

      const point =
        fresh && data?.controller.kind === "locked" && data.cursor
          ? getPointerPosition(data.cursor)
          : null;

      if (cursorRef.current) {
        cursorRef.current.hidden = !point;

        if (point) {
          cursorRef.current.style.left = `${point.x}px`;
          cursorRef.current.style.top = `${point.y}px`;
          cursorRef.current.classList.toggle(
            "is-pinching",
            Boolean(data.pinching),
          );
        }
      }

      const drag = dragRef.current;

      if (drag?.source === "cv" && !fresh) {
        cancelDrag("Nhận diện bị gián đoạn. Đã hủy kéo.");
      }

      const dragPoint =
        drag?.source === "mouse" ? mousePointRef.current : point;

      if (dragImageRef.current) {
        dragImageRef.current.hidden = !drag || !dragPoint;

        if (drag && dragPoint) {
          dragImageRef.current.style.left = `${dragPoint.x}px`;
          dragImageRef.current.style.top = `${dragPoint.y}px`;

          if (fresh) {
            findTarget(dragPoint, drag.kind, getStage(), data);
          } else {
            clearTarget();
          }
        } else {
          clearTarget();
        }
      }

      const button = !drag && point ? findButtonAt(point) : null;

      if (button !== hoveredButtonRef.current) {
        hoveredButtonRef.current?.classList.remove("cv-hover");
        button?.classList.add("cv-hover");
        hoveredButtonRef.current = button;
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      hoveredButtonRef.current?.classList.remove("cv-hover");
    };
  }, [
    cancelDrag, clearTarget, findButtonAt,
    findTarget, getPointerPosition, getStage,
  ]);

  const cvBridge = useMemo(() => ({
    reportFrame,
    reportStatus,
    handlePinchStart,
    handlePinchEnd,
    resetCv,
    cancelDrag,
    drawStickers,
    clearStickers,
  }), [
    reportFrame, reportStatus, handlePinchStart,
    handlePinchEnd, resetCv, cancelDrag,
    drawStickers, clearStickers,
  ]);

  const ready = cameraStatus === "ready" && cvStatus === "ready";
  const dragSticker = STICKERS.find((item) => item.id === draggedKind);

  const statusLabel =
    cameraStatus !== "ready"
      ? cameraStatus === "error" ? "Camera cần kiểm tra" : "Đang mở camera"
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
          {ready ? controlMessage : "Có thể dùng chuột để chọn công cụ."}
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
                      cancelDrag();
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
                aria-label={PANELS.find((item) => item.id === activePanel)?.label}
              >
                <div ref={panelBodyRef} className="panel-content">
                  {activePanel === "guide" && (
                    <>
                      <h2>Cách sử dụng</h2>
                      <ol className="instructions">
                        <li>Giữ bàn tay mở để nhận quyền.</li>
                        <li>Trỏ tới nút và chụm ngón để chọn.</li>
                        <li>Gắp sticker, giữ chụm để kéo.</li>
                        <li>Đưa tới mặt viền xanh và mở tay để dán.</li>
                        <li>Thả ngoài mặt để hủy kéo.</li>
                        <li>Giơ chữ V để chụp ảnh.</li>
                      </ol>
                    </>
                  )}

                  {activePanel === "frames" && (
                    <>
                      <h2>Chọn khung ảnh</h2>
                      <div data-cv-selectable>
                        <FramePicker
                          frames={FRAMES}
                          selectedFrameId={selectedFrameId}
                          onSelect={setSelectedFrameId}
                        />
                      </div>
                    </>
                  )}

                  {activePanel === "stickers" && (
                    <StickerPicker
                      ready={stickersReady}
                      error={assetError}
                      placements={placements}
                      onPick={(kind) => startDrag(kind, "mouse")}
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
                  ↑
                </button>
                <button
                  type="button"
                  className="scroll-button"
                  aria-label="Cuộn xuống"
                  disabled={!scrollState.canDown}
                  onClick={() => scrollPanel(1)}
                >
                  ↓
                </button>
              </div>
            </section>

            <section className="photo-panel">
              <h2>{draggedKind ? "Đang đặt sticker" : "Ảnh vừa chụp"}</h2>
              <p className="muted-text" role="status">
                {stickerMessage ||
                  "Ảnh của lượt hiện tại hiển thị dưới camera."}
              </p>
            </section>
          </aside>
        </div>

        <div ref={cursorRef} className="cv-ui-cursor" aria-hidden="true" hidden />

        <img
          ref={dragImageRef}
          src={dragSticker?.src}
          className="drag-sticker-preview"
          alt=""
          aria-hidden="true"
          hidden
        />
      </main>
    </CvUiContext.Provider>
  );
}