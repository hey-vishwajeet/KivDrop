"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { CopyIcon, DownloadIcon } from "./icons";
import { FileLedger } from "./file-ledger";
import { TransferField } from "./transfer-field";
import { getDevice } from "@/lib/device";
import { formatBytes, formatCode, formatDuration, relativeExpiry } from "@/lib/format";
import { getHeldFiles, releaseFiles } from "@/lib/file-vault";
import {
  PROTOCOL_VERSION,
  type JoinSessionResult,
  type Role,
  type SessionSnapshot,
} from "@/lib/protocol";
import {
  emitWithAck,
  getSignalingSocket,
  loadCredentials,
  saveCredentials,
  type StoredCredentials,
} from "@/lib/session-client";
import { addHistory, loadSettings } from "@/lib/storage";
import { usePeerTransfer } from "@/hooks/use-peer-transfer";

interface TransferRoomProps {
  sessionId: string;
}

type TerminalState = { kind: "expired" | "cancelled" | "rejected"; message: string } | null;

export function TransferRoom({ sessionId }: TransferRoomProps) {
  const [credentials, setCredentials] = useState<StoredCredentials | null>(null);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState<TerminalState>(null);
  const [now, setNow] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [decisionPending, setDecisionPending] = useState(false);
  const bootstrappedRef = useRef(false);
  const credentialsRef = useRef<StoredCredentials | null>(null);
  const historyWrittenRef = useRef(false);
  const autoDownloadedRef = useRef(false);
  const autoAcceptedRef = useRef(false);
  const transferStartedAtRef = useRef<number | null>(null);

  const files = credentials?.role === "sender" ? getHeldFiles(sessionId) : [];
  const manifest = session?.manifest ?? [];
  const peer = usePeerTransfer({
    enabled: session?.status === "READY" && !terminal,
    credentials,
    manifest,
    files,
  });

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !credentials?.shareToken) return "";
    return `${window.location.origin}/transfer/${sessionId}#join=${credentials.shareToken}`;
  }, [credentials?.shareToken, sessionId]);

  const setActiveCredentials = useCallback((value: StoredCredentials) => {
    credentialsRef.current = value;
    setCredentials(value);
  }, []);

  const applySnapshot = useCallback((snapshot: SessionSnapshot) => {
    setSession(snapshot);
    if (snapshot.status === "CANCELLED") {
      setTerminal({ kind: "cancelled", message: "This transfer was cancelled." });
    } else if (snapshot.status === "REJECTED") {
      setTerminal({ kind: "rejected", message: "This transfer was declined." });
    } else if (snapshot.status === "EXPIRED") {
      setTerminal({ kind: "expired", message: "This transfer has expired." });
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showQr || !shareUrl) return;
    QRCode.toDataURL(shareUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#1b1d19", light: "#fcfaf5" },
    }).then(setQrDataUrl).catch(() => setError("The QR code could not be generated."));
  }, [shareUrl, showQr]);

  const resumeSession = useCallback(async (active: StoredCredentials) => {
    const result = await emitWithAck<SessionSnapshot>("session:resume", active);
    if (!result.ok) {
      setError(result.error.message);
      if (result.error.code === "SESSION_EXPIRED") {
        setTerminal({ kind: "expired", message: result.error.message });
      }
      return false;
    }
    applySnapshot(result.data);
    setError(null);
    return true;
  }, [applySnapshot]);

  useEffect(() => {
    const socket = getSignalingSocket();
    const onSnapshot = (snapshot: SessionSnapshot) => {
      applySnapshot(snapshot);
      const active = credentialsRef.current;
      if (
        active?.role === "receiver" &&
        snapshot.status === "AWAITING_RECEIVER_APPROVAL" &&
        loadSettings().autoAccept &&
        !autoAcceptedRef.current
      ) {
        autoAcceptedRef.current = true;
        setDecisionPending(true);
        void emitWithAck<SessionSnapshot>("session:accept", {
          ...active,
          manifestRevision: snapshot.manifestRevision,
        }).then((result) => {
          if (result.ok) applySnapshot(result.data);
          else {
            autoAcceptedRef.current = false;
            setError(result.error.message);
          }
          setDecisionPending(false);
        });
      }
    };
    const onExpired = () => setTerminal({ kind: "expired", message: "This transfer expired after ten minutes without activity." });
    const onCancelled = ({ by }: { by: Role }) => setTerminal({ kind: "cancelled", message: `${by === "sender" ? "The sender" : "The receiver"} cancelled this transfer.` });
    const onRejected = ({ by }: { by: Role }) => setTerminal({ kind: "rejected", message: `${by === "sender" ? "The sender" : "The receiver"} declined this transfer.` });
    const onDisconnected = () => setError("The other device disconnected. Waiting for it to returnâ€¦");
    const onReconnected = () => setError(null);
    const onConnect = () => {
      if (credentialsRef.current) void resumeSession(credentialsRef.current);
    };

    socket.on("session:snapshot", onSnapshot);
    socket.on("session:expired", onExpired);
    socket.on("session:cancelled", onCancelled);
    socket.on("session:rejected", onRejected);
    socket.on("peer:disconnected", onDisconnected);
    socket.on("peer:reconnected", onReconnected);
    socket.on("connect", onConnect);

    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      void (async () => {
        const stored = loadCredentials(sessionId);
        if (stored) {
          setActiveCredentials(stored);
          await resumeSession(stored);
          setLoading(false);
          return;
        }

        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const shareToken = fragment.get("join");
        if (!shareToken) {
          setError("This browser does not have permission to enter the transfer. Open its full pairing link or enter the code on the Receive page.");
          setLoading(false);
          return;
        }
        const result = await emitWithAck<JoinSessionResult>("session:join", {
          v: PROTOCOL_VERSION,
          sessionId,
          shareToken,
          device: getDevice(),
        });
        if (!result.ok) {
          setError(result.error.message);
          setLoading(false);
          return;
        }
        const active = saveCredentials(sessionId, "receiver", result.data.receiverToken);
        setActiveCredentials(active);
        applySnapshot(result.data.session);
        window.history.replaceState(null, "", window.location.pathname);
        setLoading(false);
      })();
    }

    return () => {
      socket.off("session:snapshot", onSnapshot);
      socket.off("session:expired", onExpired);
      socket.off("session:cancelled", onCancelled);
      socket.off("session:rejected", onRejected);
      socket.off("peer:disconnected", onDisconnected);
      socket.off("peer:reconnected", onReconnected);
      socket.off("connect", onConnect);
    };
  }, [applySnapshot, resumeSession, sessionId, setActiveCredentials]);

  useEffect(() => {
    if (!credentials || !session || terminal) return;
    const timer = window.setInterval(async () => {
      const result = await emitWithAck<{ expiresAt: number }>("session:heartbeat", credentials);
      if (result.ok) setSession((current) => current ? { ...current, expiresAt: result.data.expiresAt } : current);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [credentials, session, terminal]);

  useEffect(() => {
    if (credentials?.role === "sender" && peer.state.phase === "ready") {
      transferStartedAtRef.current ??= Date.now();
      void peer.startTransfer();
    }
  }, [credentials?.role, peer]);

  useEffect(() => {
    if (peer.state.phase === "transferring") {
      transferStartedAtRef.current ??= Date.now();
    }
  }, [peer.state.phase]);

  useEffect(() => {
    const outcome =
      peer.state.phase === "completed"
        ? "completed"
        : peer.state.phase === "failed"
          ? "failed"
          : terminal
            ? "cancelled"
            : null;
    if (!outcome || !session || !credentials || historyWrittenRef.current) return;
    historyWrittenRef.current = true;
    const finishedAt = Date.now();
    const startedAt = transferStartedAtRef.current ?? finishedAt;
    addHistory({
      id: session.id,
      date: finishedAt,
      direction: credentials.role === "sender" ? "sent" : "received",
      peerName: credentials.role === "sender" ? session.receiver?.name ?? "Receiving device" : session.sender.name,
      fileCount: manifest.length,
      totalBytes: session.totalBytes,
      durationSeconds: Math.max(0, (finishedAt - startedAt) / 1000),
      status: outcome,
    });
    if (credentials.role === "sender") releaseFiles(session.id);

    if (outcome !== "completed") return;
    const settings = loadSettings();
    if (settings.notifications && "Notification" in window && Notification.permission === "granted") {
      new Notification("KivDrop transfer complete", { body: `${manifest.length} ${manifest.length === 1 ? "file" : "files"} transferred.` });
    }
    if (settings.sounds) {
      try {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 660;
        gain.gain.setValueAtTime(0.06, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.18);
      } catch {
        // Browsers may require a fresh user gesture before audio can start.
      }
    }
  }, [credentials, manifest.length, peer.state.phase, session, terminal]);

  useEffect(() => {
    if (
      peer.state.phase === "completed" &&
      credentials?.role === "receiver" &&
      peer.state.receivedFiles.length === 1 &&
      loadSettings().autoDownload &&
      !autoDownloadedRef.current
    ) {
      autoDownloadedRef.current = true;
      const received = peer.state.receivedFiles[0];
      const anchor = document.createElement("a");
      anchor.href = received.url;
      anchor.download = received.file.name;
      anchor.click();
    }
  }, [credentials?.role, peer.state.phase, peer.state.receivedFiles]);

  async function decide(event: "session:approve" | "session:accept" | "session:reject") {
    if (!credentials || !session || decisionPending) return;
    setDecisionPending(true);
    setError(null);
    const payload = event === "session:accept" ? { ...credentials, manifestRevision: session.manifestRevision } : credentials;
    const result = await emitWithAck<SessionSnapshot | null>(event, payload);
    if (!result.ok) setError(result.error.message);
    else if (result.data) applySnapshot(result.data);
    setDecisionPending(false);
  }

  async function cancelRoom() {
    if (!credentials) return;
    peer.cancel();
    await emitWithAck<null>("session:cancel", { ...credentials, reason: "user" });
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("The browser could not copy the link. Select it from the QR panel instead.");
    }
  }

  if (loading) {
    return <div className="room-shell"><p className="eyebrow">Transfer room</p><h1>Opening the sessionâ€¦</h1><p className="muted">Checking this browserâ€™s transfer capability.</p></div>;
  }

  if (!session || !credentials) {
    return (
      <div className="room-shell terminal-panel">
        <p className="eyebrow">Transfer unavailable</p><h1>This room could not be opened.</h1>
        <p className="lede">{error}</p>
        <div className="button-row"><Link className="button button--primary" href="/receive">Enter a pairing code</Link><Link className="button button--secondary" href="/send">Create a transfer</Link></div>
      </div>
    );
  }

  if (terminal) {
    return (
      <div className="room-shell terminal-panel">
        <p className="eyebrow">{terminal.kind}</p><h1>This transfer is closed.</h1><p className="lede">{terminal.message}</p>
        <div className="button-row"><Link className="button button--primary" href="/send">Create a new transfer</Link><Link className="button button--secondary" href="/receive">Enter another code</Link></div>
      </div>
    );
  }

  const progressPercent = session.totalBytes > 0 ? (peer.state.transferredBytes / session.totalBytes) * 100 : peer.state.phase === "completed" ? 100 : 0;
  const connected = peer.state.connection === "connected";
  const fieldState = peer.state.phase === "failed" ? "failed" : peer.state.phase === "completed" ? "completed" : peer.state.phase === "paused" ? "paused" : peer.state.phase === "transferring" ? "transferring" : session.status === "READY" ? connected ? "connected" : "connecting" : session.receiver ? "approval" : "waiting";
  const fieldStatus = peer.state.phase === "failed" ? peer.state.error ?? "The transfer failed." : peer.state.phase === "completed" ? "Every byte reached the receiving browser." : peer.state.phase === "paused" ? `Paused after ${formatBytes(peer.state.transferredBytes)}.` : peer.state.phase === "transferring" ? `Sending file ${Math.min(peer.state.activeFileIndex + 1, manifest.length)} of ${manifest.length}.` : session.status === "READY" ? connected ? `${peer.state.transport === "relay" ? "Relay" : peer.state.transport === "direct" ? "Direct" : "Peer"} connection ready.` : "Checking a direct connectionâ€¦" : session.status === "AWAITING_SENDER_APPROVAL" ? "The sender is reviewing the receiving device." : session.status === "AWAITING_RECEIVER_APPROVAL" ? "The receiver is reviewing the file list." : "Waiting for a receiving device.";
  const completedIndexes = new Set(peer.state.receivedFiles.map((received) => manifest.findIndex((file) => file.id === received.file.id)));
  const fileProgress: Record<number, number> = {};
  for (let index = 0; index < manifest.length; index += 1) {
    if (index < peer.state.activeFileIndex || completedIndexes.has(index)) fileProgress[index] = 100;
    else if (index === peer.state.activeFileIndex && manifest[index]?.size) fileProgress[index] = (peer.state.activeFileBytes / manifest[index].size) * 100;
    else fileProgress[index] = 0;
  }

  return (
    <div className="room-shell">
      <div className="session-strip">
        <div><span>Session</span><strong className="mono">{formatCode(session.code)}</strong></div>
        <div><span>Expires in</span><strong className="mono">{relativeExpiry(session.expiresAt, now || session.createdAt)}</strong></div>
        <div><span>Connection</span><strong>{peer.state.connection === "connected" ? peer.state.transport : peer.state.connection}</strong></div>
      </div>

      <TransferField senderName={session.sender.name} receiverName={session.receiver?.name} state={fieldState} progress={progressPercent} status={fieldStatus} />

      {error ? <p className="status-note status-note--warning" role="alert">{error}</p> : null}

      {credentials.role === "sender" && session.status === "WAITING_FOR_RECEIVER" ? (
        <section className="pairing-panel" aria-labelledby="pair-heading">
          <div>
            <p className="eyebrow">Ready to share</p><h2 id="pair-heading">Pair the other device.</h2>
            <p className="muted">Enter this code on the Receive page, or open the private link. You will approve the device before it sees the manifest.</p>
          </div>
          <div className="pair-code" aria-label={`Pairing code ${session.code.split("").join(" ")}`}>{formatCode(session.code)}</div>
          <div className="button-row">
            <button className="button button--primary" onClick={() => void copyLink()} type="button"><CopyIcon /> {copied ? "Link copied" : "Copy pairing link"}</button>
            <button className="button button--secondary" onClick={() => setShowQr((value) => !value)} type="button">{showQr ? "Hide QR" : "Show QR"}</button>
            <button className="button button--quiet" onClick={() => void cancelRoom()} type="button">Cancel room</button>
          </div>
          {showQr ? <div className="qr-panel">{qrDataUrl ? <Image alt="QR code containing the private KivDrop pairing link" height={240} src={qrDataUrl} unoptimized width={240} /> : <p>Generating QR codeâ€¦</p>}<input aria-label="Pairing link" readOnly value={shareUrl} /></div> : null}
        </section>
      ) : null}

      {credentials.role === "sender" && session.status === "AWAITING_SENDER_APPROVAL" && session.receiver ? (
        <section className="approval-panel">
          <div><p className="eyebrow">Device request</p><h2>Approve {session.receiver.name}?</h2><p>The receiver cannot see file names or begin a transfer until you approve it.</p></div>
          <div className="button-row"><button className="button button--primary" disabled={decisionPending} onClick={() => void decide("session:approve")} type="button">Approve this device</button><button className="button button--danger" disabled={decisionPending} onClick={() => void decide("session:reject")} type="button">Reject</button></div>
        </section>
      ) : null}

      {credentials.role === "receiver" && session.status === "AWAITING_SENDER_APPROVAL" ? (
        <section className="approval-panel"><div><p className="eyebrow">Waiting for sender</p><h2>{session.sender.name} is reviewing this device.</h2><p>The file list remains private until the sender approves you.</p></div><button className="button button--quiet" onClick={() => void decide("session:reject")} type="button">Leave transfer</button></section>
      ) : null}

      {credentials.role === "receiver" && session.status === "AWAITING_RECEIVER_APPROVAL" ? (
        <section className="manifest-review">
          <div className="manifest-heading"><div><p className="eyebrow">Review before receiving</p><h2>{manifest.length} {manifest.length === 1 ? "file" : "files"} Â· {formatBytes(session.totalBytes)}</h2></div><div className="button-row"><button className="button button--primary" disabled={decisionPending} onClick={() => void decide("session:accept")} type="button">Accept {manifest.length} {manifest.length === 1 ? "file" : "files"}</button><button className="button button--danger" disabled={decisionPending} onClick={() => void decide("session:reject")} type="button">Decline</button></div></div>
          {session.totalBytes > 512 * 1024 ** 2 ? <p className="status-note status-note--warning">This browser may assemble large received files in memory. Keep this tab open and make sure the device has enough free memory.</p> : null}
          <FileLedger files={manifest} />
        </section>
      ) : null}

      {(session.status === "READY" || peer.state.phase === "completed" || peer.state.phase === "failed") && manifest.length ? (
        <section className="progress-panel">
          <div className="progress-heading">
            <div><p className="eyebrow">{peer.state.phase === "completed" ? "Transfer receipt" : "Transfer progress"}</p><h2>{peer.state.phase === "completed" ? "Transfer complete" : `${Math.round(progressPercent)}% received`}</h2></div>
            <div className="progress-metrics"><div><span>Bytes</span><strong>{formatBytes(peer.state.transferredBytes)} / {formatBytes(session.totalBytes)}</strong></div><div><span>Speed</span><strong>{peer.state.speedBytesPerSecond ? `${formatBytes(peer.state.speedBytesPerSecond)}/s` : "Measuring"}</strong></div><div><span>Remaining</span><strong>{peer.state.etaSeconds === null ? "â€”" : formatDuration(peer.state.etaSeconds)}</strong></div></div>
          </div>
          <progress aria-label="Total transfer progress" max={session.totalBytes || 1} value={peer.state.transferredBytes} />
          <FileLedger files={manifest} progress={fileProgress} receivedIndexes={completedIndexes} />

          {peer.state.phase === "transferring" ? <div className="button-row progress-actions"><button className="button button--secondary" onClick={peer.pause} type="button">Pause</button><button className="button button--danger" onClick={() => void cancelRoom()} type="button">Cancel</button></div> : null}
          {peer.state.phase === "paused" ? <div className="button-row progress-actions"><button className="button button--primary" onClick={peer.resume} type="button">Resume</button><button className="button button--danger" onClick={() => void cancelRoom()} type="button">Cancel</button></div> : null}
          {peer.state.phase === "failed" ? <div className="button-row progress-actions">{peer.state.transferredBytes === 0 ? <button className="button button--primary" onClick={peer.retryConnection} type="button">Try direct connection again</button> : <Link className="button button--primary" href={credentials.role === "sender" ? "/send" : "/receive"}>Start a fresh transfer</Link>}<button className="button button--secondary" onClick={() => void cancelRoom()} type="button">Close transfer</button></div> : null}

          {peer.state.phase === "completed" ? (
            <div className="completion-actions">
              {credentials.role === "receiver" ? <div className="download-list">{peer.state.receivedFiles.map((received) => <a className="button button--secondary" download={received.file.name} href={received.url} key={received.file.id}><DownloadIcon /> Download {received.file.name}</a>)}</div> : <p className="status-note">The receiving browser confirmed all {formatBytes(session.totalBytes)}.</p>}
              <div className="button-row"><Link className="button button--primary" href="/send">Send more</Link><Link className="button button--secondary" href="/history">View local history</Link></div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
