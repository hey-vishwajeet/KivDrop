import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  DeviceInfo,
  ManifestFile,
  Role,
  SessionSnapshot,
  SessionStatus,
} from "../src/lib/protocol";

interface StoredPeer {
  device: DeviceInfo;
  tokenHash: Buffer;
  socketId: string | null;
  approved: boolean;
}

export interface StoredSession {
  id: string;
  code: string;
  ownerTokenHash: Buffer;
  shareTokenHash: Buffer;
  sender: StoredPeer;
  receiver: StoredPeer | null;
  manifest: ManifestFile[];
  manifestRevision: number;
  totalBytes: number;
  status: SessionStatus;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
}

interface SessionStoreOptions {
  ttlMs?: number;
  maxFiles?: number;
  maxTransferBytes?: number;
  now?: () => number;
  tokenFactory?: () => string;
  codeFactory?: () => string;
}

export type StoreFailure =
  | "INVALID_CODE"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "ROOM_FULL"
  | "NOT_AUTHORIZED"
  | "INVALID_STATE"
  | "LIMIT_EXCEEDED";

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: StoreFailure };

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function tokenMatches(token: string, expected: Buffer): boolean {
  const actual = hashToken(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly codeIndex = new Map<string, string>();
  private readonly socketIndex = new Map<string, { sessionId: string; role: Role }>();
  private readonly ttlMs: number;
  private readonly maxFiles: number;
  private readonly maxTransferBytes: number;
  private readonly now: () => number;
  private readonly tokenFactory: () => string;
  private readonly codeFactory: () => string;

  constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.maxFiles = options.maxFiles ?? 100;
    this.maxTransferBytes = options.maxTransferBytes ?? 10 * 1024 ** 3;
    this.now = options.now ?? Date.now;
    this.tokenFactory =
      options.tokenFactory ?? (() => randomBytes(24).toString("base64url"));
    this.codeFactory =
      options.codeFactory ??
      (() =>
        (randomBytes(4).readUInt32BE(0) % 1_000_000)
          .toString()
          .padStart(6, "0"));
  }

  create(
    device: DeviceInfo,
    manifest: ManifestFile[],
    socketId: string,
  ): StoreResult<{
    session: StoredSession;
    ownerToken: string;
    shareToken: string;
  }> {
    const totalBytes = manifest.reduce((sum, file) => sum + file.size, 0);
    if (
      manifest.length === 0 ||
      manifest.length > this.maxFiles ||
      totalBytes > this.maxTransferBytes
    ) {
      return { ok: false, reason: "LIMIT_EXCEEDED" };
    }

    const code = this.uniqueCode();
    if (!code) return { ok: false, reason: "LIMIT_EXCEEDED" };

    const id = this.uniqueToken();
    const ownerToken = this.tokenFactory();
    const shareToken = this.tokenFactory();
    const createdAt = this.now();
    const session: StoredSession = {
      id,
      code,
      ownerTokenHash: hashToken(ownerToken),
      shareTokenHash: hashToken(shareToken),
      sender: {
        device,
        tokenHash: hashToken(ownerToken),
        socketId,
        approved: false,
      },
      receiver: null,
      manifest,
      manifestRevision: 1,
      totalBytes,
      status: "WAITING_FOR_RECEIVER",
      createdAt,
      lastActivityAt: createdAt,
      expiresAt: createdAt + this.ttlMs,
    };

    this.sessions.set(id, session);
    this.codeIndex.set(code, id);
    this.socketIndex.set(socketId, { sessionId: id, role: "sender" });
    return { ok: true, value: { session, ownerToken, shareToken } };
  }

  join(
    lookup: { code?: string; sessionId?: string; shareToken?: string },
    device: DeviceInfo,
    socketId: string,
  ): StoreResult<{
    session: StoredSession;
    receiverToken: string;
  }> {
    const session = lookup.code
      ? this.getByCode(lookup.code)
      : lookup.sessionId
        ? this.sessions.get(lookup.sessionId)
        : undefined;

    if (!session) {
      return { ok: false, reason: lookup.code ? "INVALID_CODE" : "SESSION_NOT_FOUND" };
    }
    if (this.isExpired(session)) {
      this.delete(session.id);
      return { ok: false, reason: "SESSION_EXPIRED" };
    }
    if (lookup.shareToken && !tokenMatches(lookup.shareToken, session.shareTokenHash)) {
      return { ok: false, reason: "NOT_AUTHORIZED" };
    }
    if (!lookup.code && !lookup.shareToken) {
      return { ok: false, reason: "NOT_AUTHORIZED" };
    }
    if (session.receiver) return { ok: false, reason: "ROOM_FULL" };
    if (session.status !== "WAITING_FOR_RECEIVER") {
      return { ok: false, reason: "INVALID_STATE" };
    }

    const receiverToken = this.tokenFactory();
    session.receiver = {
      device,
      tokenHash: hashToken(receiverToken),
      socketId,
      approved: false,
    };
    session.status = "AWAITING_SENDER_APPROVAL";
    this.touch(session);
    this.socketIndex.set(socketId, { sessionId: session.id, role: "receiver" });
    return { ok: true, value: { session, receiverToken } };
  }

  resume(
    sessionId: string,
    role: Role,
    token: string,
    socketId: string,
  ): StoreResult<StoredSession> {
    const auth = this.authorize(sessionId, role, token, false);
    if (!auth.ok) return auth;
    const peer = role === "sender" ? auth.value.sender : auth.value.receiver;
    if (!peer) return { ok: false, reason: "NOT_AUTHORIZED" };
    if (peer.socketId) this.socketIndex.delete(peer.socketId);
    peer.socketId = socketId;
    this.socketIndex.set(socketId, { sessionId, role });
    this.touch(auth.value);
    return auth;
  }

  approveSender(sessionId: string, token: string): StoreResult<StoredSession> {
    const auth = this.authorize(sessionId, "sender", token);
    if (!auth.ok) return auth;
    const session = auth.value;
    if (!session.receiver || session.status !== "AWAITING_SENDER_APPROVAL") {
      return { ok: false, reason: "INVALID_STATE" };
    }
    session.sender.approved = true;
    session.status = "AWAITING_RECEIVER_APPROVAL";
    this.touch(session);
    return { ok: true, value: session };
  }

  acceptReceiver(
    sessionId: string,
    token: string,
    manifestRevision: number,
  ): StoreResult<StoredSession> {
    const auth = this.authorize(sessionId, "receiver", token);
    if (!auth.ok) return auth;
    const session = auth.value;
    if (
      !session.receiver ||
      !session.sender.approved ||
      session.status !== "AWAITING_RECEIVER_APPROVAL" ||
      manifestRevision !== session.manifestRevision
    ) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    session.receiver.approved = true;
    session.status = "READY";
    this.touch(session);
    return { ok: true, value: session };
  }

  close(
    sessionId: string,
    role: Role,
    token: string,
    status: "CANCELLED" | "REJECTED",
  ): StoreResult<StoredSession> {
    const auth = this.authorize(sessionId, role, token);
    if (!auth.ok) return auth;
    if (["CANCELLED", "REJECTED", "EXPIRED"].includes(auth.value.status)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    auth.value.status = status;
    auth.value.lastActivityAt = this.now();
    return auth;
  }

  authorize(
    sessionId: string,
    role: Role,
    token: string,
    shouldTouch = true,
  ): StoreResult<StoredSession> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "SESSION_NOT_FOUND" };
    if (this.isExpired(session)) {
      this.delete(sessionId);
      return { ok: false, reason: "SESSION_EXPIRED" };
    }
    const peer = role === "sender" ? session.sender : session.receiver;
    if (!peer || !tokenMatches(token, peer.tokenHash)) {
      return { ok: false, reason: "NOT_AUTHORIZED" };
    }
    if (shouldTouch) this.touch(session);
    return { ok: true, value: session };
  }

  disconnect(socketId: string): { session: StoredSession; role: Role } | null {
    const membership = this.socketIndex.get(socketId);
    if (!membership) return null;
    this.socketIndex.delete(socketId);
    const session = this.sessions.get(membership.sessionId);
    if (!session) return null;
    const peer = membership.role === "sender" ? session.sender : session.receiver;
    if (peer?.socketId === socketId) peer.socketId = null;
    return { session, role: membership.role };
  }

  snapshot(session: StoredSession, viewer: Role): SessionSnapshot {
    return {
      id: session.id,
      code: session.code,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      manifestRevision: session.manifestRevision,
      sender: session.sender.device,
      receiver: session.receiver?.device ?? null,
      manifest:
        viewer === "sender" || session.sender.approved ? session.manifest : null,
      totalBytes: session.totalBytes,
      senderApproved: session.sender.approved,
      receiverApproved: session.receiver?.approved ?? false,
      senderConnected: Boolean(session.sender.socketId),
      receiverConnected: Boolean(session.receiver?.socketId),
    };
  }

  sweepExpired(): StoredSession[] {
    const expired = [...this.sessions.values()].filter((session) => this.isExpired(session));
    for (const session of expired) {
      session.status = "EXPIRED";
      this.delete(session.id);
    }
    return expired;
  }

  get size(): number {
    return this.sessions.size;
  }

  private getByCode(code: string): StoredSession | undefined {
    const id = this.codeIndex.get(code);
    return id ? this.sessions.get(id) : undefined;
  }

  private touch(session: StoredSession): void {
    const time = this.now();
    session.lastActivityAt = time;
    session.expiresAt = time + this.ttlMs;
  }

  private isExpired(session: StoredSession): boolean {
    return this.now() >= session.expiresAt;
  }

  private uniqueToken(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = this.tokenFactory();
      if (!this.sessions.has(token)) return token;
    }
    return randomBytes(24).toString("base64url");
  }

  private uniqueCode(): string | null {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = this.codeFactory();
      if (/^\d{6}$/.test(code) && !this.codeIndex.has(code)) return code;
    }
    return null;
  }

  private delete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.codeIndex.delete(session.code);
    if (session.sender.socketId) this.socketIndex.delete(session.sender.socketId);
    if (session.receiver?.socketId) this.socketIndex.delete(session.receiver.socketId);
  }
}
