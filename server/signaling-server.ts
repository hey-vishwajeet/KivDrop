import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import {
  cancelSessionSchema,
  createSessionSchema,
  credentialsSchema,
  decisionSchema,
  descriptionSignalSchema,
  iceSignalSchema,
  joinSessionSchema,
  sanitizeDisplayName,
  type Ack,
  type CreateSessionResult,
  type JoinSessionResult,
  type PublicErrorCode,
  type Role,
} from "../src/lib/protocol";
import { SessionStore, type StoreFailure, type StoredSession } from "./session-store";

interface SignalingServerOptions {
  port?: number;
  origins?: string[];
  ttlMs?: number;
  maxFiles?: number;
  maxTransferBytes?: number;
}

interface RateBucket {
  attempts: number[];
}

const publicErrors: Record<StoreFailure, { code: PublicErrorCode; message: string }> = {
  INVALID_CODE: { code: "INVALID_CODE", message: "That pairing code is not active." },
  SESSION_NOT_FOUND: {
    code: "SESSION_NOT_FOUND",
    message: "That transfer could not be found.",
  },
  SESSION_EXPIRED: {
    code: "SESSION_EXPIRED",
    message: "This transfer has expired. Ask the sender to create a new one.",
  },
  ROOM_FULL: { code: "ROOM_FULL", message: "This transfer already has a receiver." },
  NOT_AUTHORIZED: {
    code: "NOT_AUTHORIZED",
    message: "This device is not authorized for that transfer.",
  },
  INVALID_STATE: {
    code: "INVALID_STATE",
    message: "That action is not available in the transfer's current state.",
  },
  LIMIT_EXCEEDED: {
    code: "LIMIT_EXCEEDED",
    message: "This selection exceeds the transfer limits.",
  },
};

function failure<T>(reason: StoreFailure): Ack<T> {
  return { ok: false, error: publicErrors[reason] };
}

function invalid<T>(): Ack<T> {
  return {
    ok: false,
    error: { code: "INVALID_REQUEST", message: "The request was not valid." },
  };
}

function safeAck<T>(ack: unknown, payload: Ack<T>): void {
  if (typeof ack === "function") (ack as (value: Ack<T>) => void)(payload);
}

function sanitizeDevice<T extends { name: string }>(device: T): T {
  return { ...device, name: sanitizeDisplayName(device.name, "Unnamed device") };
}

function sanitizeManifest<T extends { name: string }>(manifest: T[]): T[] {
  return manifest.map((file) => ({
    ...file,
    name: sanitizeDisplayName(file.name, "Untitled file"),
  }));
}

export function createSignalingServer(options: SignalingServerOptions = {}) {
  const origins = options.origins ?? ["http://localhost:3000"];
  const store = new SessionStore({
    ttlMs: options.ttlMs,
    maxFiles: options.maxFiles,
    maxTransferBytes: options.maxTransferBytes,
  });
  const httpServer: HttpServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (request.url === "/health") {
      response.writeHead(200);
      response.end(JSON.stringify({ ok: true, sessions: store.size }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ ok: false }));
  });

  const io = new SocketServer(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin || origins.includes(origin)) callback(null, true);
        else callback(new Error("Origin is not allowed"));
      },
      methods: ["GET", "POST"],
      credentials: false,
    },
    serveClient: false,
    maxHttpBufferSize: 192_000,
    transports: ["websocket", "polling"],
  });

  const rateBuckets = new Map<string, RateBucket>();

  function allowJoinAttempt(socket: Socket): boolean {
    const key = socket.handshake.address || "unknown";
    const now = Date.now();
    const bucket = rateBuckets.get(key) ?? { attempts: [] };
    bucket.attempts = bucket.attempts.filter((time) => now - time < 60_000);
    if (bucket.attempts.length >= 12) {
      rateBuckets.set(key, bucket);
      return false;
    }
    bucket.attempts.push(now);
    rateBuckets.set(key, bucket);
    return true;
  }

  function emitSnapshots(session: StoredSession): void {
    if (session.sender.socketId) {
      io.to(session.sender.socketId).emit(
        "session:snapshot",
        store.snapshot(session, "sender"),
      );
    }
    if (session.receiver?.socketId) {
      io.to(session.receiver.socketId).emit(
        "session:snapshot",
        store.snapshot(session, "receiver"),
      );
    }
  }

  function otherSocket(session: StoredSession, role: Role): string | null {
    return role === "sender"
      ? session.receiver?.socketId ?? null
      : session.sender.socketId;
  }

  io.on("connection", (socket) => {
    socket.on("session:create", (raw, ack) => {
      const parsed = createSessionSchema.safeParse(raw);
      if (!parsed.success) return safeAck(ack, invalid());
      const result = store.create(
        sanitizeDevice(parsed.data.device),
        sanitizeManifest(parsed.data.manifest),
        socket.id,
      );
      if (!result.ok) return safeAck(ack, failure(result.reason));
      socket.join(result.value.session.id);
      const payload: CreateSessionResult = {
        session: store.snapshot(result.value.session, "sender"),
        ownerToken: result.value.ownerToken,
        shareToken: result.value.shareToken,
      };
      safeAck(ack, { ok: true, data: payload });
    });

    socket.on("session:join", (raw, ack) => {
      if (!allowJoinAttempt(socket)) {
        return safeAck(ack, {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many pairing attempts. Wait a minute and try again.",
          },
        });
      }
      const parsed = joinSessionSchema.safeParse(raw);
      if (!parsed.success) return safeAck(ack, invalid());
      const result = store.join(
        {
          code: parsed.data.code,
          sessionId: parsed.data.sessionId,
          shareToken: parsed.data.shareToken,
        },
        sanitizeDevice(parsed.data.device),
        socket.id,
      );
      if (!result.ok) return safeAck(ack, failure(result.reason));
      socket.join(result.value.session.id);
      const payload: JoinSessionResult = {
        session: store.snapshot(result.value.session, "receiver"),
        receiverToken: result.value.receiverToken,
      };
      safeAck(ack, { ok: true, data: payload });
      emitSnapshots(result.value.session);
    });

    socket.on("session:resume", (raw, ack) => {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return safeAck(ack, invalid());
      const result = store.resume(
        parsed.data.sessionId,
        parsed.data.role,
        parsed.data.token,
        socket.id,
      );
      if (!result.ok) return safeAck(ack, failure(result.reason));
      socket.join(result.value.id);
      safeAck(ack, {
        ok: true,
        data: store.snapshot(result.value, parsed.data.role),
      });
      emitSnapshots(result.value);
      const peerSocket = otherSocket(result.value, parsed.data.role);
      if (peerSocket) io.to(peerSocket).emit("peer:reconnected", { role: parsed.data.role });
    });

    socket.on("session:approve", (raw, ack) => {
      const parsed = decisionSchema.safeParse(raw);
      if (!parsed.success || parsed.data.role !== "sender") return safeAck(ack, invalid());
      const result = store.approveSender(parsed.data.sessionId, parsed.data.token);
      if (!result.ok) return safeAck(ack, failure(result.reason));
      safeAck(ack, { ok: true, data: store.snapshot(result.value, "sender") });
      emitSnapshots(result.value);
    });

    socket.on("session:accept", (raw, ack) => {
      const parsed = decisionSchema.safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.role !== "receiver" ||
        !parsed.data.manifestRevision
      ) {
        return safeAck(ack, invalid());
      }
      const result = store.acceptReceiver(
        parsed.data.sessionId,
        parsed.data.token,
        parsed.data.manifestRevision,
      );
      if (!result.ok) return safeAck(ack, failure(result.reason));
      safeAck(ack, { ok: true, data: store.snapshot(result.value, "receiver") });
      emitSnapshots(result.value);
      io.to(result.value.id).emit("session:ready", { at: Date.now() });
    });

    socket.on("session:reject", (raw, ack) => {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return safeAck(ack, invalid());
      const result = store.close(
        parsed.data.sessionId,
        parsed.data.role,
        parsed.data.token,
        "REJECTED",
      );
      if (!result.ok) return safeAck(ack, failure(result.reason));
      safeAck(ack, { ok: true, data: null });
      io.to(result.value.id).emit("session:rejected", { by: parsed.data.role });
      emitSnapshots(result.value);
    });

    socket.on("session:cancel", (raw, ack) => {
      const parsed = cancelSessionSchema.safeParse(raw);
      if (!parsed.success) return safeAck(ack, invalid());
      const result = store.close(
        parsed.data.sessionId,
        parsed.data.role,
        parsed.data.token,
        "CANCELLED",
      );
      if (!result.ok) return safeAck(ack, failure(result.reason));
      safeAck(ack, { ok: true, data: null });
      io.to(result.value.id).emit("session:cancelled", {
        by: parsed.data.role,
        reason: parsed.data.reason,
      });
      emitSnapshots(result.value);
    });

    socket.on("session:heartbeat", (raw, ack) => {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return safeAck(ack, invalid());
      const result = store.authorize(
        parsed.data.sessionId,
        parsed.data.role,
        parsed.data.token,
      );
      if (!result.ok) return safeAck(ack, failure(result.reason));
      safeAck(ack, { ok: true, data: { expiresAt: result.value.expiresAt } });
    });

    socket.on("signal:description", (raw, ack) => {
      const parsed = descriptionSignalSchema.safeParse(raw);
      if (!parsed.success) return safeAck(ack, invalid());
      const result = store.authorize(
        parsed.data.sessionId,
        parsed.data.role,
        parsed.data.token,
      );
      if (!result.ok) return safeAck(ack, failure(result.reason));
      if (result.value.status !== "READY") {
        return safeAck(ack, failure("INVALID_STATE"));
      }
      const target = otherSocket(result.value, parsed.data.role);
      if (!target) return safeAck(ack, failure("INVALID_STATE"));
      io.to(target).emit("signal:description", {
        negotiationId: parsed.data.negotiationId,
        from: parsed.data.role,
        description: parsed.data.description,
      });
      safeAck(ack, { ok: true, data: null });
    });

    socket.on("signal:ice", (raw, ack) => {
      const parsed = iceSignalSchema.safeParse(raw);
      if (!parsed.success) return safeAck(ack, invalid());
      const result = store.authorize(
        parsed.data.sessionId,
        parsed.data.role,
        parsed.data.token,
      );
      if (!result.ok) return safeAck(ack, failure(result.reason));
      if (result.value.status !== "READY") {
        return safeAck(ack, failure("INVALID_STATE"));
      }
      const target = otherSocket(result.value, parsed.data.role);
      if (!target) return safeAck(ack, failure("INVALID_STATE"));
      io.to(target).emit("signal:ice", {
        negotiationId: parsed.data.negotiationId,
        from: parsed.data.role,
        candidate: parsed.data.candidate,
      });
      safeAck(ack, { ok: true, data: null });
    });

    socket.on("disconnect", () => {
      const disconnected = store.disconnect(socket.id);
      if (!disconnected) return;
      const target = otherSocket(disconnected.session, disconnected.role);
      if (target) io.to(target).emit("peer:disconnected", { role: disconnected.role });
      emitSnapshots(disconnected.session);
    });
  });

  const sweepInterval = setInterval(() => {
    for (const session of store.sweepExpired()) {
      if (session.sender.socketId) {
        io.to(session.sender.socketId).emit("session:expired");
      }
      if (session.receiver?.socketId) {
        io.to(session.receiver.socketId).emit("session:expired");
      }
    }
    const cutoff = Date.now() - 60_000;
    for (const [key, bucket] of rateBuckets) {
      bucket.attempts = bucket.attempts.filter((time) => time >= cutoff);
      if (bucket.attempts.length === 0) rateBuckets.delete(key);
    }
  }, Math.min(options.ttlMs ?? 600_000, 30_000));
  sweepInterval.unref();

  return {
    io,
    store,
    httpServer,
    async listen(port = options.port ?? 3001): Promise<number> {
      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => resolve());
      });
      const address = httpServer.address();
      return typeof address === "object" && address ? address.port : port;
    },
    async close(): Promise<void> {
      clearInterval(sweepInterval);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  };
}
