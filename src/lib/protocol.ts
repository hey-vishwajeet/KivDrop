import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_FILE_NAME_LENGTH = 180;
export const MAX_DEVICE_NAME_LENGTH = 48;

export const deviceSchema = z.object({
  id: z.string().min(8).max(80),
  name: z.string().trim().min(1).max(MAX_DEVICE_NAME_LENGTH),
  browser: z.string().trim().min(1).max(40),
  kind: z.enum(["desktop", "mobile", "tablet", "unknown"]),
});

export const manifestFileSchema = z.object({
  id: z.string().min(8).max(80),
  name: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
  size: z.number().int().nonnegative().safe(),
  type: z.string().max(120),
  lastModified: z.number().int().nonnegative().safe(),
});

export const manifestSchema = z.array(manifestFileSchema).min(1).max(100);

export const roleSchema = z.enum(["sender", "receiver"]);

export const credentialsSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().min(16).max(80),
  role: roleSchema,
  token: z.string().min(24).max(160),
});

export const createSessionSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  device: deviceSchema,
  manifest: manifestSchema,
});

export const joinSessionSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    device: deviceSchema,
    code: z.string().regex(/^\d{6}$/).optional(),
    sessionId: z.string().min(16).max(80).optional(),
    shareToken: z.string().min(24).max(160).optional(),
  })
  .refine(
    (value) => Boolean(value.code || (value.sessionId && value.shareToken)),
    "A pairing code or complete share capability is required",
  );

export const decisionSchema = credentialsSchema.extend({
  manifestRevision: z.number().int().positive().optional(),
});

export const descriptionSignalSchema = credentialsSchema.extend({
  negotiationId: z.string().min(8).max(80),
  description: z.object({
    type: z.enum(["offer", "answer", "pranswer", "rollback"]),
    sdp: z.string().max(160_000).optional(),
  }),
});

export const iceSignalSchema = credentialsSchema.extend({
  negotiationId: z.string().min(8).max(80),
  candidate: z
    .object({
      candidate: z.string().max(4_000),
      sdpMid: z.string().max(120).nullable().optional(),
      sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    })
    .nullable(),
});

export const cancelSessionSchema = credentialsSchema.extend({
  reason: z.enum(["user", "connection-failed", "transfer-failed"]).default("user"),
});

export type DeviceInfo = z.infer<typeof deviceSchema>;
export type ManifestFile = z.infer<typeof manifestFileSchema>;
export type Role = z.infer<typeof roleSchema>;
export type SessionCredentials = z.infer<typeof credentialsSchema>;

export type SessionStatus =
  | "WAITING_FOR_RECEIVER"
  | "AWAITING_SENDER_APPROVAL"
  | "AWAITING_RECEIVER_APPROVAL"
  | "READY"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED";

export interface SessionSnapshot {
  id: string;
  code: string;
  status: SessionStatus;
  createdAt: number;
  expiresAt: number;
  manifestRevision: number;
  sender: DeviceInfo;
  receiver: DeviceInfo | null;
  manifest: ManifestFile[] | null;
  totalBytes: number;
  senderApproved: boolean;
  receiverApproved: boolean;
  senderConnected: boolean;
  receiverConnected: boolean;
}

export type PublicErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CODE"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "ROOM_FULL"
  | "RATE_LIMITED"
  | "NOT_AUTHORIZED"
  | "INVALID_STATE"
  | "PEER_DISCONNECTED"
  | "LIMIT_EXCEEDED"
  | "SERVER_ERROR";

export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: PublicErrorCode; message: string } };

export interface CreateSessionResult {
  session: SessionSnapshot;
  ownerToken: string;
  shareToken: string;
}

export interface JoinSessionResult {
  session: SessionSnapshot;
  receiverToken: string;
}

export interface RelayedDescription {
  negotiationId: string;
  from: Role;
  description: RTCSessionDescriptionInit;
}

export interface RelayedIceCandidate {
  negotiationId: string;
  from: Role;
  candidate: RTCIceCandidateInit | null;
}

export function sanitizeDisplayName(value: string, fallback: string): string {
  const safe = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069/\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (safe || fallback).slice(0, MAX_FILE_NAME_LENGTH);
}

export function totalManifestBytes(manifest: ManifestFile[]): number {
  return manifest.reduce((total, file) => total + file.size, 0);
}
