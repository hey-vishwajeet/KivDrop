"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon } from "@/components/icons";
import { QrScanner } from "@/components/qr-scanner";
import { getDevice } from "@/lib/device";
import { formatCode } from "@/lib/format";
import { PROTOCOL_VERSION, type JoinSessionResult } from "@/lib/protocol";
import { emitWithAck, getSignalingSocket, saveCredentials } from "@/lib/session-client";

export default function ReceivePage() {
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"code" | "scan">("code");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    getSignalingSocket();
    inputRef.current?.focus();
  }, []);

  async function join() {
    if (code.length !== 6 || joining) return;
    setJoining(true);
    setError(null);
    const result = await emitWithAck<JoinSessionResult>("session:join", {
      v: PROTOCOL_VERSION,
      code,
      device: getDevice(),
    });
    if (!result.ok) {
      setError(result.error.message);
      setJoining(false);
      inputRef.current?.focus();
      return;
    }
    saveCredentials(result.data.session.id, "receiver", result.data.receiverToken);
    router.push(`/transfer/${result.data.session.id}`);
  }

  return (
    <div className="receive-shell">
      <div className="page-heading">
        <p className="eyebrow">Join a transfer</p>
        <h1>Receive files.</h1>
        <p>The sender will review this device before you see or accept the file list.</p>
      </div>

      <div className="mode-tabs" role="tablist" aria-label="Pairing method">
        <button aria-selected={mode === "code"} onClick={() => setMode("code")} role="tab" type="button">Enter code</button>
        <button aria-selected={mode === "scan"} onClick={() => setMode("scan")} role="tab" type="button">Scan QR</button>
      </div>

      {mode === "code" ? (
        <form onSubmit={(event) => { event.preventDefault(); void join(); }}>
          <div className="code-field">
            <label htmlFor="pairing-code">Six-digit pairing code</label>
            <input
              aria-describedby="code-help"
              aria-invalid={Boolean(error)}
              autoComplete="one-time-code"
              id="pairing-code"
              inputMode="numeric"
              maxLength={7}
              onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
              placeholder="000 000"
              ref={inputRef}
              value={formatCode(code)}
            />
            <span id="code-help">Codes expire after ten minutes without activity.</span>
          </div>
          {error ? <p className="status-note status-note--danger" role="alert">{error}</p> : null}
          <button className="button button--primary receive-action" disabled={code.length !== 6 || joining} type="submit">
            {joining ? "Checking code…" : "Join transfer"} {!joining ? <ArrowRightIcon /> : null}
          </button>
        </form>
      ) : <QrScanner onClose={() => setMode("code")} />}

      <p className="receive-privacy"><strong>No account required.</strong> This browser stores only your device label, preferences, and optional transfer history.</p>
    </div>
  );
}
