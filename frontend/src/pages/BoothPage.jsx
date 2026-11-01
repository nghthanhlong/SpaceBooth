import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraStage from "../components/camera/CameraStage";
import FramePicker from "../components/frames/FramePicker";
import { CvUiContext } from "../components/camera/CvUiContext";
import { FRAMES } from "../data/frames";

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

  const [scrollState, setScrollState] = useState({
    canUp: false,
    canDown: false,
  });

  const interactionRef = useRef(null);
  const cameraColumnRef = useRef(null);
  const sidebarRef = useRef(null);
  const panelScrollRef = useRef(null);
  const panelBodyRef = useRef(null);
  const cursorElementRef = useRef(null);

  const latestFrameRef = useRef(null);
  const lastFrameAtRef = useRef(0);
  const hoveredButtonRef = useRef(null);
  const messageRef = useRef("");

  const selectedFrame =
    FRAMES.find((item) => item.id === selectedFrameId) ?? FRAMES[0];

  const reportStatus = useCallback((camera, cv) => {
    setCameraStatus(camera);
    setCvStatus(cv);
  }, []);

  const reportFrame = useCallback((data) => {
    latestFrameRef.current = data;
    lastFrameAtRef.current = performance.now();

    let message = "Giữ bàn tay mở để nhận quyền điều khiển.";

    if (data.controller.kind === "arming") {
      message = `Đang nhận quyền: ${Math.round(
        data.controller.progress * 100,
      )}%`;
    } else if (data.controller.kind === "locked") {
      message = data.pinching
        ? "Đang chụm ngón — mở tay trước lần chọn tiếp theo."
        : "Đã nhận quyền — trỏ tới nút rồi chụm ngón để chọn.";
    }

    if (messageRef.current !== message) {
      messageRef.current = message;
      setControlMessage(message);
    }
  }, []);

  // Cột phải lấy chiều cao thật của vùng hình camera.
  // Việc đổi tab không được phép thay đổi chiều cao này.
  useEffect(() => {
    const stage =
      cameraColumnRef.current?.querySelector(".camera-stage");

    const sidebar = sidebarRef.current;

    if (!stage || !sidebar) return;

    function syncHeight() {
      const height = stage.getBoundingClientRect().height;

      if (height > 0) {
        sidebar.style.setProperty("--camera-height", `${height}px`);
      }
    }

    syncHeight();

    const observer = new ResizeObserver(syncHeight);
    observer.observe(stage);

    return () => observer.disconnect();
  }, []);

  const updateScrollState = useCallback(() => {
    const element = panelScrollRef.current;
    if (!element) return;

    const canUp = element.scrollTop > 2;
    const canDown =
      element.scrollTop + element.clientHeight < element.scrollHeight - 2;

    setScrollState((previous) => {
      if (
        previous.canUp === canUp &&
        previous.canDown === canDown
      ) {
        return previous;
      }

      return { canUp, canDown };
    });
  }, []);

  // Khi đổi tab, cuộn về đầu và cập nhật hai nút Lên/Xuống.
  useEffect(() => {
    const scrollArea = panelScrollRef.current;
    const body = panelBodyRef.current;

    if (!scrollArea || !body) return;

    scrollArea.scrollTop = 0;
    updateScrollState();

    const observer = new ResizeObserver(updateScrollState);
    observer.observe(scrollArea);
    observer.observe(body);

    return () => observer.disconnect();
  }, [activePanel, updateScrollState]);

  function scrollPanel(direction) {
    const element = panelScrollRef.current;
    if (!element) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    element.scrollBy({
      top: direction * Math.max(100, element.clientHeight * 0.7),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }

  // Camera và bảng công cụ là vùng điều khiển chính.
  // Danh sách album phía dưới không làm thay đổi vùng ánh xạ con trỏ.
  const getPointerPosition = useCallback((point) => {
    const layout = interactionRef.current;
    const stage =
      cameraColumnRef.current?.querySelector(".camera-stage");
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

    const top = Math.max(
      0,
      Math.min(stageRect.top, sidebarRect.top),
    );

    const bottom = Math.min(
      window.innerHeight,
      Math.max(stageRect.bottom, sidebarRect.bottom),
    );

    if (right <= left || bottom <= top) return null;

    const x = Math.max(0, Math.min(1, point.x));
    const y = Math.max(0, Math.min(1, point.y));

    return {
      x: left + x * Math.max(0, right - left - 1),
      y: top + y * Math.max(0, bottom - top - 1),
    };
  }, []);

  const findButtonAt = useCallback((position) => {
    if (!position) return null;

    const element = document.elementFromPoint(
      position.x,
      position.y,
    );

    const button = element?.closest("button");

    if (
      !button ||
      button.disabled ||
      !button.closest("[data-cv-selectable]") ||
      !interactionRef.current?.contains(button)
    ) {
      return null;
    }

    return button;
  }, []);

  const handlePinchStart = useCallback(
    (point) => {
      const data = latestFrameRef.current;

      if (
        data?.controller.kind !== "locked" ||
        performance.now() - lastFrameAtRef.current > 500
      ) {
        return;
      }

      const position = getPointerPosition(point);
      findButtonAt(position)?.click();
    },
    [findButtonAt, getPointerPosition],
  );

  const resetCv = useCallback(() => {
    latestFrameRef.current = null;
    lastFrameAtRef.current = 0;
    messageRef.current = "";

    setControlMessage(
      "Giữ bàn tay mở để nhận quyền điều khiển.",
    );

    if (cursorElementRef.current) {
      cursorElementRef.current.hidden = true;
    }

    hoveredButtonRef.current?.classList.remove("cv-hover");
    hoveredButtonRef.current = null;
  }, []);

  useEffect(() => {
    let animationId;

    function drawCursor() {
      const data = latestFrameRef.current;
      const cursor = cursorElementRef.current;

      const visible =
        data?.controller.kind === "locked" &&
        data.cursor &&
        performance.now() - lastFrameAtRef.current <= 500;

      const position = visible
        ? getPointerPosition(data.cursor)
        : null;

      if (cursor) {
        cursor.hidden = !position;

        if (position) {
          cursor.style.left = `${position.x}px`;
          cursor.style.top = `${position.y}px`;

          cursor.classList.toggle(
            "is-pinching",
            Boolean(data.pinching),
          );
        }
      }

      const button = position
        ? findButtonAt(position)
        : null;

      if (button !== hoveredButtonRef.current) {
        hoveredButtonRef.current?.classList.remove("cv-hover");
        button?.classList.add("cv-hover");
        hoveredButtonRef.current = button;
      }

      animationId = requestAnimationFrame(drawCursor);
    }

    drawCursor();

    return () => {
      cancelAnimationFrame(animationId);
      hoveredButtonRef.current?.classList.remove("cv-hover");
    };
  }, [findButtonAt, getPointerPosition]);

  const cvBridge = useMemo(
    () => ({
      reportFrame,
      reportStatus,
      handlePinchStart,
      resetCv,
    }),
    [reportFrame, reportStatus, handlePinchStart, resetCv],
  );

  const ready =
    cameraStatus === "ready" && cvStatus === "ready";

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

          <p
            className={`system-status ${ready ? "is-ready" : ""}`}
          >
            <span
              className="status-dot"
              aria-hidden="true"
            />
            {statusLabel}
          </p>
        </header>

        <div className="interaction-hint" role="status">
          {ready
            ? controlMessage
            : "Bạn vẫn có thể dùng chuột để chọn khung."}
        </div>

        <div
          ref={interactionRef}
          className="booth-layout"
        >
          <div
            ref={cameraColumnRef}
            className="camera-column"
          >
            <CameraStage frame={selectedFrame} />
          </div>

          <aside
            ref={sidebarRef}
            className="booth-sidebar"
          >
            <section
              className="control-panel"
              aria-label="Bảng công cụ"
            >
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
                    onClick={() => setActivePanel(panel.id)}
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
                  PANELS.find(
                    (panel) => panel.id === activePanel,
                  )?.label
                }
              >
                <div
                  ref={panelBodyRef}
                  className="panel-content"
                >
                  {activePanel === "guide" && (
                    <>
                      <h2>Cách sử dụng</h2>

                      <ol className="instructions">
                        <li>
                          Giữ bàn tay mở để nhận quyền
                          điều khiển.
                        </li>
                        <li>
                          Di chuyển tay để đưa con trỏ
                          tới lựa chọn.
                        </li>
                        <li>
                          Chụm ngón để chọn, mở tay để
                          chọn tiếp.
                        </li>
                        <li>
                          Giơ chữ V để bắt đầu đếm ngược
                          chụp ảnh.
                        </li>
                        <li>
                          Dùng nút Lên/Xuống khi bảng
                          công cụ có nội dung dài.
                        </li>
                      </ol>
                    </>
                  )}

                  {activePanel === "frames" && (
                    <>
                      <h2>Chọn khung ảnh</h2>

                      <p className="muted-text">
                        Trỏ tới khung rồi chụm ngón để chọn.
                      </p>

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
                    <>
                      <h2>Sticker</h2>

                      <p className="muted-text">
                        Bộ sticker sẽ được bổ sung ở
                        bước tiếp theo.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div
                className="panel-scroll-controls"
                data-cv-selectable
              >
                <button
                  type="button"
                  className="scroll-button"
                  aria-label="Cuộn bảng công cụ lên"
                  disabled={!scrollState.canUp}
                  onClick={() => scrollPanel(-1)}
                >
                  ↑
                </button>

                <button
                  type="button"
                  className="scroll-button"
                  aria-label="Cuộn bảng công cụ xuống"
                  disabled={!scrollState.canDown}
                  onClick={() => scrollPanel(1)}
                >
                  ↓
                </button>
              </div>
            </section>

            <section className="photo-panel">
              <h2>Ảnh vừa chụp</h2>

              <p className="muted-text">
                Ảnh của lượt hiện tại đang nằm dưới
                camera. Ô xem nhanh sẽ được nối khi
                làm màn chọn ảnh.
              </p>
            </section>
          </aside>
        </div>

        <div
          ref={cursorElementRef}
          className="cv-ui-cursor"
          aria-hidden="true"
          hidden
        />
      </main>
    </CvUiContext.Provider>
  );
}