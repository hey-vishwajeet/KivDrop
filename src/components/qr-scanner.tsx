"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function QrScanner({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    let stop: (() => void) | undefined;

    async function begin() {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result) => {
            if (!result || stopped) return;
            try {
              const url = new URL(result.getText(), window.location.origin);
              if (url.origin !== window.location.origin || !url.pathname.startsWith("/transfer/")) {
                setError("That QR code is not an KivDrop pairing link.");
                return;
              }
              stopped = true;
              controls.stop();
              router.push(`${url.pathname}${url.search}${url.hash}`);
            } catch {
              setError("That QR code does not contain a valid pairing link.");
            }
          },
        );
        if (stopped) controls.stop();
        else stop = () => controls.stop();
      } catch (reason) {
        const name = reason instanceof DOMException ? reason.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera access was denied. Allow it in browser settings or enter the six-digit code instead."
            : "The camera could not start. Enter the six-digit code instead.",
        );
      }
    }

    void begin();
    return () => {
      stopped = true;
      stop?.();
    };
  }, [router]);

  return (
    <div className="scanner-panel">
      <div className="scanner-frame"><video aria-label="Live camera preview for QR scanning" muted playsInline ref={videoRef} /></div>
      {error ? <p className="status-note status-note--danger" role="alert">{error}</p> : <p className="small muted">Point the camera at an KivDrop pairing code.</p>}
      <button className="button button--secondary" onClick={onClose} type="button">Use a number instead</button>
    </div>
  );
}
