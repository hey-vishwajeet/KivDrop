import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  Ack,
  CreateSessionResult,
  DeviceInfo,
  JoinSessionResult,
  ManifestFile,
  RelayedDescription,
  RelayedIceCandidate,
  SessionSnapshot,
} from "../src/lib/protocol";
import { createSignalingServer } from "./signaling-server";

const senderDevice: DeviceInfo = {
  id: "sender-device",
  name: "Sender laptop",
  browser: "Firefox",
  kind: "desktop",
};

const receiverDevice: DeviceInfo = {
  id: "receiver-device",
  name: "Receiver phone",
  browser: "Safari",
  kind: "mobile",
};

const manifest: ManifestFile[] = [
  {
    id: "holiday-photo",
    name: "holiday.jpg",
    size: 1_024,
    type: "image/jpeg",
    lastModified: 1_700_000_000_000,
  },
];

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No acknowledgement for ${event}`)), 2_000);

    socket.emit(event, payload, (response: Ack<T>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function unwrap<T>(ack: Ack<T>): T {
  if (!ack.ok) throw new Error(`Expected success, received ${ack.error.code}`);
  return ack.data;
}

function nextEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`No ${event} event received`));
    }, 2_000);
    const onEvent = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };

    socket.once(event, onEvent);
  });
}

function nextMatchingEvent<T>(
  socket: Socket,
  event: string,
  matches: (payload: T) => boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`No matching ${event} event received`));
    }, 2_000);
    const onEvent = (payload: T) => {
      if (!matches(payload)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    };

    socket.on(event, onEvent);
  });
}

function connect(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error("Socket.IO client did not connect"));
    }, 2_000);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function pauseForUnexpectedEvents(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

describe("signaling server Socket.IO integration", () => {
  let signalingServer: ReturnType<typeof createSignalingServer>;
  let url: string;
  let clients: Socket[];

  beforeEach(async () => {
    signalingServer = createSignalingServer();
    const port = await signalingServer.listen(0);
    url = `http://127.0.0.1:${port}`;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await signalingServer.close();
  });

  async function newClient(): Promise<Socket> {
    const client = await connect(url);
    clients.push(client);
    return client;
  }

  async function createSession(sender: Socket): Promise<CreateSessionResult> {
    return unwrap(
      await emitWithAck<CreateSessionResult>(sender, "session:create", {
        v: 1,
        device: senderDevice,
        manifest,
      }),
    );
  }

  async function joinSession(
    receiver: Socket,
    code: string,
  ): Promise<JoinSessionResult> {
    return unwrap(
      await emitWithAck<JoinSessionResult>(receiver, "session:join", {
        v: 1,
        device: receiverDevice,
        code,
      }),
    );
  }

  it("pairs by code, completes both approvals, emits ready, and isolates signaling", async () => {
    const sender = await newClient();
    const receiver = await newClient();
    const outsider = await newClient();
    const created = await createSession(sender);

    expect(created.session).toMatchObject({
      status: "WAITING_FOR_RECEIVER",
      sender: senderDevice,
      receiver: null,
      manifest,
    });

    const inactiveCode = await emitWithAck<JoinSessionResult>(outsider, "session:join", {
      v: 1,
      device: receiverDevice,
      code: "000000",
    });
    expect(inactiveCode).toMatchObject({
      ok: false,
      error: { code: "INVALID_CODE" },
    });

    const malformedJoin = await emitWithAck<JoinSessionResult>(outsider, "session:join", {
      v: 1,
      device: receiverDevice,
      code: "123",
    });
    expect(malformedJoin).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });

    const joined = await joinSession(receiver, created.session.code);
    expect(joined.session).toMatchObject({
      id: created.session.id,
      status: "AWAITING_SENDER_APPROVAL",
      receiver: receiverDevice,
      manifest: null,
    });

    const senderApproval = unwrap(
      await emitWithAck<SessionSnapshot>(sender, "session:approve", {
        v: 1,
        sessionId: created.session.id,
        role: "sender",
        token: created.ownerToken,
      }),
    );
    expect(senderApproval).toMatchObject({
      status: "AWAITING_RECEIVER_APPROVAL",
      senderApproved: true,
      receiverApproved: false,
      manifest,
    });

    const senderReady = nextEvent<{ at: number }>(sender, "session:ready");
    const receiverReady = nextEvent<{ at: number }>(receiver, "session:ready");
    const receiverAcceptance = unwrap(
      await emitWithAck<SessionSnapshot>(receiver, "session:accept", {
        v: 1,
        sessionId: created.session.id,
        role: "receiver",
        token: joined.receiverToken,
        manifestRevision: created.session.manifestRevision,
      }),
    );

    expect(receiverAcceptance).toMatchObject({
      status: "READY",
      senderApproved: true,
      receiverApproved: true,
    });
    const [senderReadyPayload, receiverReadyPayload] = await Promise.all([
      senderReady,
      receiverReady,
    ]);
    expect(senderReadyPayload.at).toEqual(expect.any(Number));
    expect(receiverReadyPayload.at).toEqual(expect.any(Number));

    const senderDescriptionSpy = vi.fn();
    const outsiderDescriptionSpy = vi.fn();
    sender.on("signal:description", senderDescriptionSpy);
    outsider.on("signal:description", outsiderDescriptionSpy);
    const relayedDescription = nextEvent<RelayedDescription>(
      receiver,
      "signal:description",
    );
    const offer = { type: "offer" as const, sdp: "v=0\r\n" };

    const descriptionAck = await emitWithAck<null>(sender, "signal:description", {
      v: 1,
      sessionId: created.session.id,
      role: "sender",
      token: created.ownerToken,
      negotiationId: "offer-round-one",
      description: offer,
    });
    expect(descriptionAck).toEqual({ ok: true, data: null });
    await expect(relayedDescription).resolves.toEqual({
      negotiationId: "offer-round-one",
      from: "sender",
      description: offer,
    });
    await pauseForUnexpectedEvents();
    expect(senderDescriptionSpy).not.toHaveBeenCalled();
    expect(outsiderDescriptionSpy).not.toHaveBeenCalled();

    const receiverIceSpy = vi.fn();
    const outsiderIceSpy = vi.fn();
    receiver.on("signal:ice", receiverIceSpy);
    outsider.on("signal:ice", outsiderIceSpy);
    const relayedIce = nextEvent<RelayedIceCandidate>(sender, "signal:ice");
    const candidate = {
      candidate: "candidate:1 1 UDP 1 192.0.2.1 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };

    const iceAck = await emitWithAck<null>(receiver, "signal:ice", {
      v: 1,
      sessionId: created.session.id,
      role: "receiver",
      token: joined.receiverToken,
      negotiationId: "offer-round-one",
      candidate,
    });
    expect(iceAck).toEqual({ ok: true, data: null });
    await expect(relayedIce).resolves.toEqual({
      negotiationId: "offer-round-one",
      from: "receiver",
      candidate,
    });
    await pauseForUnexpectedEvents();
    expect(receiverIceSpy).not.toHaveBeenCalled();
    expect(outsiderIceSpy).not.toHaveBeenCalled();

    const unauthorizedRelay = await emitWithAck<null>(outsider, "signal:description", {
      v: 1,
      sessionId: created.session.id,
      role: "sender",
      token: "unauthorized-token-000000000",
      negotiationId: "intruder-offer",
      description: offer,
    });
    expect(unauthorizedRelay).toMatchObject({
      ok: false,
      error: { code: "NOT_AUTHORIZED" },
    });
  });

  it.each([
    { action: "session:reject", terminalEvent: "session:rejected", status: "REJECTED" },
    { action: "session:cancel", terminalEvent: "session:cancelled", status: "CANCELLED" },
  ])("broadcasts $terminalEvent and closes the session", async ({
    action,
    terminalEvent,
    status,
  }) => {
    const sender = await newClient();
    const receiver = await newClient();
    const created = await createSession(sender);
    const joined = await joinSession(receiver, created.session.code);
    const actor = action === "session:reject" ? receiver : sender;
    const role = action === "session:reject" ? "receiver" : "sender";
    const token = action === "session:reject" ? joined.receiverToken : created.ownerToken;
    const senderTerminalEvent = nextEvent<{ by: string; reason?: string }>(
      sender,
      terminalEvent,
    );
    const receiverTerminalEvent = nextEvent<{ by: string; reason?: string }>(
      receiver,
      terminalEvent,
    );
    const terminalSnapshot = nextMatchingEvent<SessionSnapshot>(
      sender,
      "session:snapshot",
      (snapshot) => snapshot.status === status,
    );

    const ack = await emitWithAck<null>(actor, action, {
      v: 1,
      sessionId: created.session.id,
      role,
      token,
      ...(action === "session:cancel" ? { reason: "user" } : {}),
    });

    expect(ack).toEqual({ ok: true, data: null });
    const expectedEvent =
      action === "session:cancel"
        ? { by: "sender", reason: "user" }
        : { by: "receiver" };
    await expect(senderTerminalEvent).resolves.toEqual(expectedEvent);
    await expect(receiverTerminalEvent).resolves.toEqual(expectedEvent);
    await expect(terminalSnapshot).resolves.toMatchObject({ status });
  });
});
