"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type {
  ManifestFile,
  RelayedDescription,
  RelayedIceCandidate,
  SessionCredentials,
} from "@/lib/protocol";
import { emitWithAck, getSignalingSocket } from "@/lib/session-client";
import {
  decodeFrame,
  DEFAULT_WIRE_PAYLOAD,
  encodeFrame,
  LOGICAL_CHUNK_SIZE,
  waitForDataChannelCapacity,
} from "@/lib/transfer-wire";

type ConnectionPhase = "idle" | "connecting" | "connected" | "failed" | "closed";
export type TransferPhase = "idle" | "ready" | "transferring" | "paused" | "completed" | "cancelled" | "failed";

export interface ReceivedTransferFile {
  file: ManifestFile;
  url: string;
  blob: Blob;
}

export interface PeerTransferState {
  connection: ConnectionPhase;
  phase: TransferPhase;
  transport: "direct" | "relay" | "unknown";
  transferredBytes: number;
  activeFileBytes: number;
  activeFileIndex: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  receivedFiles: ReceivedTransferFile[];
  error: string | null;
}

interface UsePeerTransferOptions {
  enabled: boolean;
  credentials: SessionCredentials | null;
  manifest: ManifestFile[];
  files: File[];
}

type ControlMessage =
  | { type: "file:start"; fileIndex: number }
  | { type: "file:end"; fileIndex: number }
  | { type: "file:received"; fileIndex: number }
  | { type: "ack"; fileIndex: number; fileBytes: number; totalBytes: number }
  | { type: "transfer:end" }
  | { type: "transfer:received" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel"; reason?: string }
  | { type: "protocol:error"; message: string };

interface ReceivingFile {
  fileIndex: number;
  nextChunkIndex: number;
  bytes: number;
  chunks: ArrayBuffer[];
}

const INITIAL_STATE: PeerTransferState = {
  connection: "idle",
  phase: "idle",
  transport: "unknown",
  transferredBytes: 0,
  activeFileBytes: 0,
  activeFileIndex: 0,
  speedBytesPerSecond: 0,
  etaSeconds: null,
  receivedFiles: [],
  error: null,
};

function iceServers(): RTCIceServer[] {
  const stunUrls = (process.env.NEXT_PUBLIC_STUN_URLS ?? "stun:stun.l.google.com:19302")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const servers: RTCIceServer[] = stunUrls.length ? [{ urls: stunUrls }] : [];
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

async function detectTransport(peer: RTCPeerConnection): Promise<"direct" | "relay" | "unknown"> {
  try {
    const stats = await peer.getStats();
    let selectedLocalCandidateId: string | undefined;
    stats.forEach((report) => {
      if (report.type === "transport" && report.selectedCandidatePairId) {
        const pair = stats.get(report.selectedCandidatePairId);
        selectedLocalCandidateId = pair?.localCandidateId;
      }
      if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
        selectedLocalCandidateId ??= report.localCandidateId;
      }
    });
    const local = selectedLocalCandidateId ? stats.get(selectedLocalCandidateId) : null;
    return local?.candidateType === "relay" ? "relay" : local ? "direct" : "unknown";
  } catch {
    return "unknown";
  }
}

export function usePeerTransfer({ enabled, credentials, manifest, files }: UsePeerTransferOptions) {
  const [state, setState] = useState<PeerTransferState>(INITIAL_STATE);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const negotiationIdRef = useRef<string | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const startedConnectionRef = useRef(false);
  const startedTransferRef = useRef(false);
  const receivingRef = useRef<ReceivingFile | null>(null);
  const receivedTotalRef = useRef(0);
  const pausedRef = useRef(false);
  const pauseResolversRef = useRef<Array<() => void>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const timingRef = useRef({ startedAt: 0, lastAt: 0, lastBytes: 0, smoothedSpeed: 0 });
  const objectUrlsRef = useRef<string[]>([]);

  const totalBytes = manifest.reduce((sum, file) => sum + file.size, 0);

  const updateProgress = useCallback(
    (transferredBytes: number, fileIndex: number, fileBytes: number) => {
      const now = performance.now();
      const timing = timingRef.current;
      let speed = timing.smoothedSpeed;
      if (timing.lastAt === 0) {
        timing.startedAt = now;
        timing.lastAt = now;
        timing.lastBytes = transferredBytes;
      } else if (now - timing.lastAt >= 120) {
        const instant = ((transferredBytes - timing.lastBytes) * 1000) / (now - timing.lastAt);
        if (instant >= 0 && Number.isFinite(instant)) {
          speed = speed === 0 ? instant : speed * 0.72 + instant * 0.28;
        }
        timing.lastAt = now;
        timing.lastBytes = transferredBytes;
        timing.smoothedSpeed = speed;
      }
      setState((previous) => ({
        ...previous,
        transferredBytes: Math.min(transferredBytes, totalBytes),
        activeFileIndex: fileIndex,
        activeFileBytes: fileBytes,
        speedBytesPerSecond: speed,
        etaSeconds: speed > 0 ? Math.max(0, (totalBytes - transferredBytes) / speed) : null,
      }));
    },
    [totalBytes],
  );

  const sendControl = useCallback((message: ControlMessage) => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify({ v: 1, ...message }));
    return true;
  }, []);

  const fail = useCallback((message: string) => {
    abortRef.current?.abort();
    setState((previous) => ({
      ...previous,
      connection: previous.connection === "connected" ? previous.connection : "failed",
      phase: "failed",
      error: message,
    }));
  }, []);

  const handleControl = useCallback(
    (message: ControlMessage) => {
      if (message.type === "file:start") {
        const file = manifest[message.fileIndex];
        if (!file || receivingRef.current) {
          sendControl({ type: "protocol:error", message: "Unexpected file start" });
          fail("The incoming transfer did not match the approved file list.");
          return;
        }
        receivingRef.current = {
          fileIndex: message.fileIndex,
          nextChunkIndex: 0,
          bytes: 0,
          chunks: [],
        };
        setState((previous) => ({
          ...previous,
          phase: "transferring",
          activeFileIndex: message.fileIndex,
          activeFileBytes: 0,
        }));
        return;
      }

      if (message.type === "file:end") {
        const receiving = receivingRef.current;
        const file = manifest[message.fileIndex];
        if (!receiving || !file || receiving.fileIndex !== message.fileIndex || receiving.bytes !== file.size) {
          sendControl({ type: "protocol:error", message: "File length mismatch" });
          fail("A received file was incomplete. No download was created for it.");
          return;
        }
        const blob = new Blob(receiving.chunks, { type: file.type || "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.push(url);
        setState((previous) => ({
          ...previous,
          receivedFiles: [...previous.receivedFiles, { file, url, blob }],
        }));
        receivingRef.current = null;
        sendControl({ type: "file:received", fileIndex: message.fileIndex });
        return;
      }

      if (message.type === "ack") {
        updateProgress(message.totalBytes, message.fileIndex, message.fileBytes);
        return;
      }

      if (message.type === "transfer:end") {
        if (receivedTotalRef.current !== totalBytes || receivingRef.current) {
          sendControl({ type: "protocol:error", message: "Transfer length mismatch" });
          fail("The transfer ended before every byte arrived.");
          return;
        }
        setState((previous) => ({
          ...previous,
          phase: "completed",
          transferredBytes: totalBytes,
          etaSeconds: 0,
        }));
        sendControl({ type: "transfer:received" });
        return;
      }

      if (message.type === "transfer:received") {
        setState((previous) => ({
          ...previous,
          phase: "completed",
          transferredBytes: totalBytes,
          etaSeconds: 0,
        }));
        return;
      }

      if (message.type === "pause") {
        pausedRef.current = true;
        setState((previous) => ({ ...previous, phase: "paused" }));
        return;
      }

      if (message.type === "resume") {
        pausedRef.current = false;
        pauseResolversRef.current.splice(0).forEach((resolve) => resolve());
        setState((previous) => ({ ...previous, phase: "transferring" }));
        return;
      }

      if (message.type === "cancel") {
        abortRef.current?.abort();
        setState((previous) => ({
          ...previous,
          phase: "cancelled",
          error: message.reason ?? "The other device cancelled the transfer.",
        }));
        return;
      }

      if (message.type === "protocol:error") fail(message.message);
    },
    [fail, manifest, sendControl, totalBytes, updateProgress],
  );

  const handleDataMessage = useCallback(
    async (data: unknown) => {
      if (typeof data === "string") {
        try {
          const parsed = JSON.parse(data) as ControlMessage & { v?: number };
          if (parsed.v !== 1 || typeof parsed.type !== "string") throw new Error();
          handleControl(parsed);
        } catch {
          fail("The peer sent an unreadable transfer message.");
        }
        return;
      }

      try {
        const buffer = data instanceof Blob ? await data.arrayBuffer() : (data as ArrayBuffer);
        const frame = decodeFrame(buffer);
        const receiving = receivingRef.current;
        const file = manifest[frame.fileIndex];
        if (
          !receiving ||
          !file ||
          receiving.fileIndex !== frame.fileIndex ||
          receiving.nextChunkIndex !== frame.chunkIndex ||
          receiving.bytes !== frame.offset ||
          receiving.bytes + frame.payload.byteLength > file.size
        ) {
          throw new Error("Frame does not match the accepted manifest");
        }
        receiving.chunks.push(frame.payload);
        receiving.bytes += frame.payload.byteLength;
        receiving.nextChunkIndex += 1;
        receivedTotalRef.current += frame.payload.byteLength;
        updateProgress(receivedTotalRef.current, frame.fileIndex, receiving.bytes);
        sendControl({
          type: "ack",
          fileIndex: frame.fileIndex,
          fileBytes: receiving.bytes,
          totalBytes: receivedTotalRef.current,
        });
      } catch (error) {
        sendControl({ type: "protocol:error", message: "Invalid binary transfer frame" });
        fail(error instanceof Error ? error.message : "An invalid file chunk was received.");
      }
    },
    [fail, handleControl, manifest, sendControl, updateProgress],
  );

  const attachChannel = useCallback(
    (channel: RTCDataChannel) => {
      channelRef.current = channel;
      channel.binaryType = "arraybuffer";
      channel.addEventListener("open", async () => {
        const transport = peerRef.current ? await detectTransport(peerRef.current) : "unknown";
        setState((previous) => ({
          ...previous,
          connection: "connected",
          phase: "ready",
          transport,
          error: null,
        }));
      });
      channel.addEventListener("message", (event) => void handleDataMessage(event.data));
      channel.addEventListener("close", () => {
        if (channelRef.current !== channel) return;
        setState((previous) =>
          previous.phase === "completed" || previous.phase === "cancelled"
            ? { ...previous, connection: "closed" }
            : {
                ...previous,
                connection: "closed",
                phase: "failed",
                error: "The direct connection closed before the transfer finished.",
              },
        );
      });
      channel.addEventListener("error", () => fail("The direct file channel encountered an error."));
    },
    [fail, handleDataMessage],
  );

  const makePeer = useCallback(() => {
    if (!credentials) throw new Error("Session credentials are missing");
    if (peerRef.current) return peerRef.current;
    const peer = new RTCPeerConnection({ iceServers: iceServers() });
    peerRef.current = peer;
    setState((previous) => ({ ...previous, connection: "connecting", error: null }));
    peer.addEventListener("icecandidate", (event) => {
      const negotiationId = negotiationIdRef.current;
      if (!negotiationId) return;
      void emitWithAck("signal:ice", {
        ...credentials,
        negotiationId,
        candidate: event.candidate?.toJSON() ?? null,
      });
    });
    peer.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "failed") {
        fail("A direct connection could not be established. Check TURN configuration or try another network.");
      }
      if (peer.connectionState === "disconnected") {
        setState((previous) => ({ ...previous, connection: "connecting" }));
      }
    });
    if (credentials.role === "sender") {
      attachChannel(peer.createDataChannel("KivDrop-v1", { ordered: true }));
    } else {
      peer.addEventListener("datachannel", (event) => attachChannel(event.channel));
    }
    return peer;
  }, [attachChannel, credentials, fail]);

  const beginConnection = useCallback(async () => {
    if (!enabled || !credentials || startedConnectionRef.current) return;
    if (typeof RTCPeerConnection === "undefined") {
      fail("This browser does not support WebRTC data channels.");
      return;
    }
    startedConnectionRef.current = true;
    try {
      const peer = makePeer();
      if (credentials.role === "sender") {
        const negotiationId = crypto.randomUUID();
        negotiationIdRef.current = negotiationId;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const response = await emitWithAck<null>("signal:description", {
          ...credentials,
          negotiationId,
          description: { type: offer.type, sdp: offer.sdp },
        });
        if (!response.ok) throw new Error(response.error.message);
      }
    } catch (error) {
      startedConnectionRef.current = false;
      fail(error instanceof Error ? error.message : "The direct connection could not start.");
    }
  }, [credentials, enabled, fail, makePeer]);

  useEffect(() => {
    if (!credentials) return;
    const socket = getSignalingSocket();
    socketRef.current = socket;

    const onDescription = async (payload: RelayedDescription) => {
      try {
        const peer = makePeer();
        if (payload.description.type === "offer") negotiationIdRef.current = payload.negotiationId;
        if (payload.negotiationId !== negotiationIdRef.current) return;
        await peer.setRemoteDescription(payload.description);
        for (const candidate of queuedCandidatesRef.current.splice(0)) {
          await peer.addIceCandidate(candidate);
        }
        if (payload.description.type === "offer") {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          const response = await emitWithAck<null>("signal:description", {
            ...credentials,
            negotiationId: payload.negotiationId,
            description: { type: answer.type, sdp: answer.sdp },
          });
          if (!response.ok) throw new Error(response.error.message);
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : "WebRTC negotiation failed.");
      }
    };

    const onIce = async (payload: RelayedIceCandidate) => {
      if (payload.negotiationId !== negotiationIdRef.current || !payload.candidate) return;
      const peer = peerRef.current;
      if (!peer?.remoteDescription) {
        queuedCandidatesRef.current.push(payload.candidate);
        return;
      }
      try {
        await peer.addIceCandidate(payload.candidate);
      } catch {
        fail("A network candidate could not be applied to the peer connection.");
      }
    };

    socket.on("signal:description", onDescription);
    socket.on("signal:ice", onIce);
    return () => {
      socket.off("signal:description", onDescription);
      socket.off("signal:ice", onIce);
    };
  }, [credentials, fail, makePeer]);

  useEffect(() => {
    const task = window.setTimeout(() => void beginConnection(), 0);
    return () => window.clearTimeout(task);
  }, [beginConnection]);

  const waitWhilePaused = useCallback(async () => {
    if (!pausedRef.current) return;
    await new Promise<void>((resolve) => pauseResolversRef.current.push(resolve));
  }, []);

  const startTransfer = useCallback(async () => {
    if (
      !credentials ||
      credentials.role !== "sender" ||
      startedTransferRef.current ||
      channelRef.current?.readyState !== "open"
    ) return;
    if (files.length !== manifest.length) {
      fail("The original files are no longer available in this tab. Create a new transfer.");
      return;
    }
    startedTransferRef.current = true;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const now = performance.now();
    timingRef.current = { startedAt: now, lastAt: now, lastBytes: 0, smoothedSpeed: 0 };
    setState((previous) => ({ ...previous, phase: "transferring", error: null }));

    try {
      const channel = channelRef.current;
      const peer = peerRef.current;
      if (!channel || !peer) throw new Error("The direct connection is not ready");
      const reportedMaximum = peer.sctp?.maxMessageSize || DEFAULT_WIRE_PAYLOAD + 20;
      const wirePayload = Math.max(1, Math.min(DEFAULT_WIRE_PAYLOAD, reportedMaximum - 20));

      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        sendControl({ type: "file:start", fileIndex });
        let chunkIndex = 0;
        for (let logicalOffset = 0; logicalOffset < file.size; logicalOffset += LOGICAL_CHUNK_SIZE) {
          await waitWhilePaused();
          if (signal.aborted) throw new DOMException("Transfer cancelled", "AbortError");
          const logicalBuffer = await file
            .slice(logicalOffset, Math.min(file.size, logicalOffset + LOGICAL_CHUNK_SIZE))
            .arrayBuffer();
          for (let partOffset = 0; partOffset < logicalBuffer.byteLength; partOffset += wirePayload) {
            await waitWhilePaused();
            await waitForDataChannelCapacity(channel, signal);
            const payload = logicalBuffer.slice(partOffset, Math.min(logicalBuffer.byteLength, partOffset + wirePayload));
            channel.send(encodeFrame(fileIndex, chunkIndex, logicalOffset + partOffset, payload));
            chunkIndex += 1;
          }
        }
        sendControl({ type: "file:end", fileIndex });
      }
      sendControl({ type: "transfer:end" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      fail(error instanceof Error ? error.message : "The file could not be read or sent.");
    }
  }, [credentials, fail, files, manifest.length, sendControl, waitWhilePaused]);

  const pause = useCallback(() => {
    if (state.phase !== "transferring") return;
    pausedRef.current = true;
    sendControl({ type: "pause" });
    setState((previous) => ({ ...previous, phase: "paused" }));
  }, [sendControl, state.phase]);

  const resume = useCallback(() => {
    if (state.phase !== "paused") return;
    pausedRef.current = false;
    pauseResolversRef.current.splice(0).forEach((resolve) => resolve());
    sendControl({ type: "resume" });
    setState((previous) => ({ ...previous, phase: "transferring" }));
  }, [sendControl, state.phase]);

  const cancel = useCallback(() => {
    sendControl({ type: "cancel", reason: "The other device cancelled the transfer." });
    abortRef.current?.abort();
    pauseResolversRef.current.splice(0).forEach((resolve) => resolve());
    setState((previous) => ({ ...previous, phase: "cancelled" }));
  }, [sendControl]);

  const retryConnection = useCallback(() => {
    const previousChannel = channelRef.current;
    channelRef.current = null;
    previousChannel?.close();
    peerRef.current?.close();
    peerRef.current = null;
    negotiationIdRef.current = null;
    queuedCandidatesRef.current = [];
    startedConnectionRef.current = false;
    startedTransferRef.current = false;
    setState({ ...INITIAL_STATE, receivedFiles: state.receivedFiles });
    queueMicrotask(() => void beginConnection());
  }, [beginConnection, state.receivedFiles]);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      abortRef.current?.abort();
      channelRef.current?.close();
      peerRef.current?.close();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  return { state, startTransfer, pause, resume, cancel, retryConnection };
}
