import { io, type Socket } from "socket.io-client";
import type { Ack, Role, SessionCredentials } from "./protocol";

const CREDENTIAL_PREFIX = "KivDrop:session:";
let socket: Socket | null = null;

export interface StoredCredentials extends SessionCredentials {
  shareToken?: string;
}

export function getSignalingSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:3001", {
      autoConnect: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 8,
    });
  }
  return socket;
}

export function emitWithAck<T>(event: string, payload: unknown, timeout = 10_000): Promise<Ack<T>> {
  const client = getSignalingSocket();
  return new Promise((resolve) => {
    client.timeout(timeout).emit(event, payload, (error: Error | null, response: Ack<T>) => {
      if (error || !response) {
        resolve({
          ok: false,
          error: {
            code: "SERVER_ERROR",
            message: "The signaling service did not respond. Check your connection and try again.",
          },
        });
        return;
      }
      resolve(response);
    });
  });
}

export function saveCredentials(
  sessionId: string,
  role: Role,
  token: string,
  shareToken?: string,
): StoredCredentials {
  const credentials: StoredCredentials = {
    v: 1,
    sessionId,
    role,
    token,
    shareToken,
  };
  sessionStorage.setItem(`${CREDENTIAL_PREFIX}${sessionId}`, JSON.stringify(credentials));
  return credentials;
}

export function loadCredentials(sessionId: string): StoredCredentials | null {
  try {
    const value = sessionStorage.getItem(`${CREDENTIAL_PREFIX}${sessionId}`);
    return value ? (JSON.parse(value) as StoredCredentials) : null;
  } catch {
    return null;
  }
}

export function removeCredentials(sessionId: string): void {
  sessionStorage.removeItem(`${CREDENTIAL_PREFIX}${sessionId}`);
}
