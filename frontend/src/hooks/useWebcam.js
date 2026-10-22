import { useEffect, useRef, useState } from "react";
import { CAMERA_CONSTRAINTS } from "../config/camera";

function getCameraError(error) {
  switch (error.name) {
    case "NotAllowedError":
      return "Chưa được cấp quyền camera, hãy cấp quyền và thử lại";

    case "NotFoundError":
      return "Không tìm thấy camera trên thiết bị";

    case "NotReadableError":
      return "Không mở được camera, hãy kiểm tra ứng dụng khác có thể đang dùng camera";

    default:
      return "Không thể mở camera, hãy kiểm tra thiết bị rồi thử lại";
  }
}

export default function useWebcam() {
  const videoRef = useRef(null);

  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    let stream = null;
    let cancelled = false;

    async function startCamera() {
      setStatus("loading");
      setError("");

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Trình duyệt không hỗ trợ mở camera");
        }

        stream = await navigator.mediaDevices.getUserMedia(
          CAMERA_CONSTRAINTS,
        );

        // Người dùng đã rời màn hình trong lúc chờ cấp quyền.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        if (!video) {
          throw new Error("Không tìm thấy phần tử video");
        }

        video.srcObject = stream;
        await video.play();

        if (!cancelled) {
          setStatus("ready");
        }
      } catch (cameraError) {
        stream?.getTracks().forEach((track) => track.stop());

        if (!cancelled) {
          setStatus("error");
          setError(getCameraError(cameraError));
        }
      }
    }

    startCamera();

    // Tắt camera khi rời màn hình hoặc trước khi thử lại.
    return () => {
      cancelled = true;

      stream?.getTracks().forEach((track) => track.stop());

      if (video && stream && video.srcObject === stream) {
        video.srcObject = null;
      }
    };
  }, [attempt]);

  function retry() {
    setAttempt((previous) => previous + 1);
  }

  return {
    videoRef,
    status,
    error,
    retry,
  };
}