import { useCallback, useEffect, useRef, useState } from "react";

export default function useCountdownAudio() {
  const contextRef = useRef(null);
  const enabledRef = useRef(false);

  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");

  const toggle = useCallback(async () => {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      return;
    }

    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("Trình duyệt chưa hỗ trợ âm thanh.");
      }

      if (!contextRef.current || contextRef.current.state === "closed") {
        contextRef.current = new AudioContextClass();
      }

      await contextRef.current.resume();

      enabledRef.current = true;
      setEnabled(true);
      setError("");
    } catch (audioError) {
      enabledRef.current = false;
      setEnabled(false);
      setError(audioError.message || "Không bật được âm thanh.");
    }
  }, []);

  const tone = useCallback((frequency, duration, volume = 0.12) => {
    const context = contextRef.current;

    if (
      !enabledRef.current ||
      !context ||
      context.state !== "running"
    ) {
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);

    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }, []);

  const playTick = useCallback((seconds) => {
    // Ba giây cuối cao hơn và dài hơn.
    tone(seconds <= 3 ? 1000 : 600, seconds <= 3 ? 0.18 : 0.09);
  }, [tone]);

  const playCapture = useCallback(() => {
    tone(1400, 0.2, 0.16);
  }, [tone]);

  useEffect(() => () => {
    enabledRef.current = false;
    const context = contextRef.current;

    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }
  }, []);

  return { enabled, error, toggle, playTick, playCapture };
}