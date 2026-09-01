import { describe, expect, it } from "vitest";
import type { DeviceInfo, ManifestFile } from "../src/lib/protocol";
import { SessionStore, type StoreResult } from "./session-store";

const sender: DeviceInfo = {
  id: "sender-device",
  name: "Sender laptop",
  browser: "Firefox",
  kind: "desktop",
};

const receiver: DeviceInfo = {
  id: "receiver-device",
  name: "Receiver phone",
  browser: "Safari",
  kind: "mobile",
};

const manifest: ManifestFile[] = [
  {
    id: "file-one",
    name: "holiday.jpg",
    size: 1_024,
    type: "image/jpeg",
    lastModified: 1_700_000_000_000,
  },
  {
    id: "file-two",
    name: "notes.txt",
    size: 512,
    type: "text/plain",
    lastModified: 1_700_000_000_001,
  },
];

function unwrap<T>(result: StoreResult<T>): T {
  if (!result.ok) throw new Error(`Expected success, received ${result.reason}`);
  return result.value;
}

function createHarness(options: {
  now?: number;
  ttlMs?: number;
  maxFiles?: number;
  maxTransferBytes?: number;
  tokens?: string[];
  codes?: string[];
} = {}) {
  let currentTime = options.now ?? 10_000;
  let tokenIndex = 0;
  let codeIndex = 0;
  const tokens = options.tokens ?? [
    "session-id-token",
    "sender-owner-token",
    "share-capability-token",
    "receiver-access-token",
  ];
  const codes = options.codes ?? ["123456"];
  const store = new SessionStore({
    ttlMs: options.ttlMs,
    maxFiles: options.maxFiles,
    maxTransferBytes: options.maxTransferBytes,
    now: () => currentTime,
    tokenFactory: () => tokens[tokenIndex++] ?? `generated-token-${tokenIndex}`,
    codeFactory: () => codes[codeIndex++] ?? codes.at(-1) ?? "654321",
  });

  return {
    store,
    setTime(value: number) {
      currentTime = value;
    },
  };
}

describe("SessionStore", () => {
  it("creates a session with the production default factories", () => {
    const store = new SessionStore();

    const result = store.create(sender, manifest, "sender-socket");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.code).toMatch(/^\d{6}$/);
    expect(result.value.session.id).toBeTruthy();
    expect(result.value.ownerToken).toBeTruthy();
    expect(result.value.shareToken).toBeTruthy();
  });

  it("creates a waiting session with computed totals and private token hashes", () => {
    const { store } = createHarness({ ttlMs: 5_000 });

    const { session, ownerToken, shareToken } = unwrap(
      store.create(sender, manifest, "sender-socket"),
    );

    expect(store.size).toBe(1);
    expect(ownerToken).toBe("sender-owner-token");
    expect(shareToken).toBe("share-capability-token");
    expect(session).toMatchObject({
      id: "session-id-token",
      code: "123456",
      sender: {
        device: sender,
        socketId: "sender-socket",
        approved: false,
      },
      receiver: null,
      manifest,
      manifestRevision: 1,
      totalBytes: 1_536,
      status: "WAITING_FOR_RECEIVER",
      createdAt: 10_000,
      lastActivityAt: 10_000,
      expiresAt: 15_000,
    });
    expect(session.ownerTokenHash).toBeInstanceOf(Buffer);
    expect(session.shareTokenHash).toBeInstanceOf(Buffer);
    expect(session.ownerTokenHash.toString("utf8")).not.toContain(ownerToken);
  });

  it.each([
    { label: "an empty manifest", files: [] as ManifestFile[] },
    { label: "too many files", files: manifest },
    {
      label: "too many bytes",
      files: [{ ...manifest[0], size: 11 }],
    },
  ])("rejects $label", ({ files }) => {
    const { store } = createHarness({ maxFiles: 1, maxTransferBytes: 10 });

    expect(store.create(sender, files, "sender-socket")).toEqual({
      ok: false,
      reason: "LIMIT_EXCEEDED",
    });
    expect(store.size).toBe(0);
  });

  it("accepts manifests exactly at the configured limits", () => {
    const oneFile = [{ ...manifest[0], size: 10 }];
    const { store } = createHarness({ maxFiles: 1, maxTransferBytes: 10 });

    expect(store.create(sender, oneFile, "sender-socket").ok).toBe(true);
  });

  it("retries invalid and colliding codes and fails after exhausting attempts", () => {
    const first = createHarness({
      tokens: [
        "session-one",
        "owner-one",
        "share-one",
        "session-two",
        "owner-two",
        "share-two",
      ],
      codes: ["bad", "111111", "111111", "222222"],
    });

    expect(unwrap(first.store.create(sender, manifest, "socket-one")).session.code).toBe(
      "111111",
    );
    expect(unwrap(first.store.create(sender, manifest, "socket-two")).session.code).toBe(
      "222222",
    );

    const exhausted = createHarness({ codes: Array(20).fill("not-six-digits") });
    expect(exhausted.store.create(sender, manifest, "socket")).toEqual({
      ok: false,
      reason: "LIMIT_EXCEEDED",
    });
  });

  it("joins by pairing code, hides the manifest, and rejects a second receiver", () => {
    const { store } = createHarness();
    const created = unwrap(store.create(sender, manifest, "sender-socket"));

    const joined = unwrap(
      store.join({ code: created.session.code }, receiver, "receiver-socket"),
    );

    expect(joined.receiverToken).toBe("receiver-access-token");
    expect(joined.session.status).toBe("AWAITING_SENDER_APPROVAL");
    expect(joined.session.receiver?.device).toEqual(receiver);
    expect(store.snapshot(joined.session, "receiver").manifest).toBeNull();
    expect(store.join({ code: created.session.code }, receiver, "other-socket")).toEqual({
      ok: false,
      reason: "ROOM_FULL",
    });
  });

  it("requires a valid share capability when joining by session id", () => {
    const { store } = createHarness();
    const created = unwrap(store.create(sender, manifest, "sender-socket"));

    expect(
      store.join({ sessionId: created.session.id }, receiver, "receiver-socket"),
    ).toEqual({ ok: false, reason: "NOT_AUTHORIZED" });
    expect(
      store.join(
        { sessionId: created.session.id, shareToken: "wrong-token" },
        receiver,
        "receiver-socket",
      ),
    ).toEqual({ ok: false, reason: "NOT_AUTHORIZED" });

    const joined = store.join(
      { sessionId: created.session.id, shareToken: created.shareToken },
      receiver,
      "receiver-socket",
    );
    expect(joined.ok).toBe(true);
  });

  it("returns lookup-specific errors for unknown sessions", () => {
    const { store } = createHarness();

    expect(store.join({ code: "999999" }, receiver, "socket")).toEqual({
      ok: false,
      reason: "INVALID_CODE",
    });
    expect(
      store.join(
        { sessionId: "missing-session", shareToken: "share-token" },
        receiver,
        "socket",
      ),
    ).toEqual({ ok: false, reason: "SESSION_NOT_FOUND" });
  });

  it("enforces sender then receiver approval and the current manifest revision", () => {
    const { store } = createHarness();
    const created = unwrap(store.create(sender, manifest, "sender-socket"));
    const joined = unwrap(
      store.join({ code: created.session.code }, receiver, "receiver-socket"),
    );

    expect(
      store.acceptReceiver(created.session.id, joined.receiverToken, 1),
    ).toEqual({ ok: false, reason: "INVALID_STATE" });
    expect(store.approveSender(created.session.id, "wrong-token")).toEqual({
      ok: false,
      reason: "NOT_AUTHORIZED",
    });

    const senderApproved = unwrap(
      store.approveSender(created.session.id, created.ownerToken),
    );
    expect(senderApproved.status).toBe("AWAITING_RECEIVER_APPROVAL");
    expect(senderApproved.sender.approved).toBe(true);
    expect(store.snapshot(senderApproved, "receiver").manifest).toEqual(manifest);
    expect(
      store.acceptReceiver(created.session.id, joined.receiverToken, 2),
    ).toEqual({ ok: false, reason: "INVALID_STATE" });

    const ready = unwrap(
      store.acceptReceiver(created.session.id, joined.receiverToken, 1),
    );
    expect(ready.status).toBe("READY");
    expect(ready.receiver?.approved).toBe(true);
    expect(store.approveSender(created.session.id, created.ownerToken)).toEqual({
      ok: false,
      reason: "INVALID_STATE",
    });
  });

  it("builds role-aware snapshots with connection and approval state", () => {
    const { store } = createHarness();
    const created = unwrap(store.create(sender, manifest, "sender-socket"));
    const joined = unwrap(
      store.join({ code: created.session.code }, receiver, "receiver-socket"),
    );

    expect(store.snapshot(joined.session, "sender")).toEqual({
      id: created.session.id,
      code: "123456",
      status: "AWAITING_SENDER_APPROVAL",
      createdAt: 10_000,
      expiresAt: 610_000,
      manifestRevision: 1,
      sender,
      receiver,
      manifest,
      totalBytes: 1_536,
      senderApproved: false,
      receiverApproved: false,
      senderConnected: true,
      receiverConnected: true,
    });
  });

  it("resumes a disconnected peer with a new socket and extends the expiry", () => {
    const harness = createHarness({ ttlMs: 1_000 });
    const created = unwrap(
      harness.store.create(sender, manifest, "original-sender-socket"),
    );

    expect(harness.store.disconnect("unknown-socket")).toBeNull();
    expect(harness.store.disconnect("original-sender-socket")).toEqual({
      session: created.session,
      role: "sender",
    });
    expect(created.session.sender.socketId).toBeNull();

    harness.setTime(10_500);
    const resumed = unwrap(
      harness.store.resume(
        created.session.id,
        "sender",
        created.ownerToken,
        "new-sender-socket",
      ),
    );
    expect(resumed.sender.socketId).toBe("new-sender-socket");
    expect(resumed.lastActivityAt).toBe(10_500);
    expect(resumed.expiresAt).toBe(11_500);
    expect(harness.store.disconnect("original-sender-socket")).toBeNull();
  });

  it("rejects invalid authorization without extending the session", () => {
    const harness = createHarness({ ttlMs: 1_000 });
    const created = unwrap(harness.store.create(sender, manifest, "sender-socket"));
    harness.setTime(10_500);

    expect(
      harness.store.authorize(created.session.id, "sender", "wrong-token"),
    ).toEqual({ ok: false, reason: "NOT_AUTHORIZED" });
    expect(created.session.expiresAt).toBe(11_000);
  });

  it("closes active sessions once and authorizes either participant", () => {
    const { store } = createHarness();
    const created = unwrap(store.create(sender, manifest, "sender-socket"));
    const joined = unwrap(
      store.join({ code: created.session.code }, receiver, "receiver-socket"),
    );

    const rejected = unwrap(
      store.close(created.session.id, "receiver", joined.receiverToken, "REJECTED"),
    );
    expect(rejected.status).toBe("REJECTED");
    expect(
      store.close(created.session.id, "sender", created.ownerToken, "CANCELLED"),
    ).toEqual({ ok: false, reason: "INVALID_STATE" });
  });

  it("expires at the exact deadline, deletes indexes, and cannot be resumed", () => {
    const harness = createHarness({ ttlMs: 1_000 });
    const created = unwrap(harness.store.create(sender, manifest, "sender-socket"));
    harness.setTime(11_000);

    expect(
      harness.store.authorize(created.session.id, "sender", created.ownerToken),
    ).toEqual({ ok: false, reason: "SESSION_EXPIRED" });
    expect(harness.store.size).toBe(0);
    expect(
      harness.store.join({ code: created.session.code }, receiver, "receiver-socket"),
    ).toEqual({ ok: false, reason: "INVALID_CODE" });
    expect(harness.store.disconnect("sender-socket")).toBeNull();
  });

  it("sweeps every expired session while preserving active sessions", () => {
    const harness = createHarness({
      ttlMs: 1_000,
      tokens: [
        "expired-session",
        "expired-owner",
        "expired-share",
        "active-session",
        "active-owner",
        "active-share",
      ],
      codes: ["111111", "222222"],
    });
    const expired = unwrap(
      harness.store.create(sender, manifest, "expired-sender-socket"),
    );
    harness.setTime(10_500);
    const active = unwrap(
      harness.store.create(sender, manifest, "active-sender-socket"),
    );
    harness.setTime(11_000);

    expect(harness.store.sweepExpired()).toEqual([
      expect.objectContaining({ id: expired.session.id, status: "EXPIRED" }),
    ]);
    expect(harness.store.size).toBe(1);
    expect(
      harness.store.authorize(active.session.id, "sender", active.ownerToken, false).ok,
    ).toBe(true);
    expect(harness.store.disconnect("expired-sender-socket")).toBeNull();
  });
});
