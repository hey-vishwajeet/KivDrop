import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRAME_HEADER_BYTES,
  decodeFrame,
  encodeFrame,
  waitForDataChannelCapacity,
} from "./transfer-wire";

class MockDataChannel extends EventTarget {
  readyState: RTCDataChannelState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
}

function dataChannel(channel: MockDataChannel): RTCDataChannel {
  return channel as unknown as RTCDataChannel;
}

describe("transfer wire frames", () => {
  it("encodes and decodes frame metadata and payload", () => {
    const payload = Uint8Array.from([0, 1, 127, 128, 255]).buffer;

    const frame = encodeFrame(42, 123_456, 9_007_199_254_740_991, payload);
    const decoded = decodeFrame(frame);

    expect(frame.byteLength).toBe(FRAME_HEADER_BYTES + payload.byteLength);
    expect(decoded).toEqual({
      fileIndex: 42,
      chunkIndex: 123_456,
      offset: Number.MAX_SAFE_INTEGER,
      payload: expect.any(ArrayBuffer),
    });
    expect(new Uint8Array(decoded.payload)).toEqual(new Uint8Array(payload));
  });

  it("writes the supported version, frame type, and declared payload length", () => {
    const payload = new Uint8Array([3, 5, 8]).buffer;
    const frame = encodeFrame(7, 11, 13, payload);
    const view = new DataView(frame);

    expect(view.getUint8(0)).toBe(1);
    expect(view.getUint8(1)).toBe(1);
    expect(view.getUint16(2)).toBe(7);
    expect(view.getUint32(4)).toBe(11);
    expect(view.getBigUint64(8)).toBe(13n);
    expect(view.getUint32(16)).toBe(payload.byteLength);
  });

  it("rejects frames shorter than the header", () => {
    expect(() => decodeFrame(new ArrayBuffer(FRAME_HEADER_BYTES - 1))).toThrow(
      "Frame is too short",
    );
  });

  it.each([
    ["version", 0, 2],
    ["frame type", 1, 2],
  ])("rejects an unsupported %s", (_label, byteOffset, value) => {
    const frame = encodeFrame(0, 0, 0, new ArrayBuffer(0));
    new DataView(frame).setUint8(byteOffset, value);

    expect(() => decodeFrame(frame)).toThrow("Unsupported transfer frame");
  });

  it("rejects a payload length that does not match the frame", () => {
    const frame = encodeFrame(0, 0, 0, new Uint8Array([1, 2]).buffer);
    new DataView(frame).setUint32(16, 3);

    expect(() => decodeFrame(frame)).toThrow(
      "Transfer frame length does not match its header",
    );
  });

  it("rejects offsets that cannot be represented safely as numbers", () => {
    const frame = encodeFrame(0, 0, 0, new ArrayBuffer(0));
    new DataView(frame).setBigUint64(8, BigInt(Number.MAX_SAFE_INTEGER) + 1n);

    expect(() => decodeFrame(frame)).toThrow("Transfer offset is too large");
  });
});

describe("waitForDataChannelCapacity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects immediately when the channel is not open", async () => {
    const channel = new MockDataChannel();
    channel.readyState = "closed";

    await expect(waitForDataChannelCapacity(dataChannel(channel))).rejects.toThrow(
      "The peer connection is not open",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves immediately at or below the high-water mark", async () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = 100;

    await expect(
      waitForDataChannelCapacity(dataChannel(channel), undefined, 100, 25),
    ).resolves.toBeUndefined();
    expect(channel.bufferedAmountLowThreshold).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sets the low-water threshold and resolves on bufferedamountlow", async () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = 101;
    const removeListener = vi.spyOn(channel, "removeEventListener");

    const capacity = waitForDataChannelCapacity(
      dataChannel(channel),
      undefined,
      100,
      25,
    );

    expect(channel.bufferedAmountLowThreshold).toBe(25);
    expect(vi.getTimerCount()).toBe(1);
    channel.dispatchEvent(new Event("bufferedamountlow"));

    await expect(capacity).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith(
      "bufferedamountlow",
      expect.any(Function),
    );
  });

  it("resolves when polling observes the low-water mark", async () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = 101;
    const capacity = waitForDataChannelCapacity(
      dataChannel(channel),
      undefined,
      100,
      25,
    );

    channel.bufferedAmount = 25;
    await vi.advanceTimersByTimeAsync(100);

    await expect(capacity).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects when polling observes that the channel closed", async () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = 101;
    const capacity = waitForDataChannelCapacity(
      dataChannel(channel),
      undefined,
      100,
      25,
    );
    const rejection = expect(capacity).rejects.toThrow(
      "The peer connection closed while sending",
    );

    channel.readyState = "closed";
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects on a channel close event", async () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = 101;
    const capacity = waitForDataChannelCapacity(
      dataChannel(channel),
      undefined,
      100,
      25,
    );
    const rejection = expect(capacity).rejects.toThrow(
      "The peer connection closed while sending",
    );

    channel.dispatchEvent(new Event("close"));

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with AbortError when the transfer is cancelled", async () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = 101;
    const controller = new AbortController();
    const capacity = waitForDataChannelCapacity(
      dataChannel(channel),
      controller.signal,
      100,
      25,
    );
    const rejection = expect(capacity).rejects.toMatchObject({
      name: "AbortError",
      message: "Transfer cancelled",
    });

    controller.abort();

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects immediately when passed an already-aborted signal", async () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = 101;
    const controller = new AbortController();
    controller.abort();
    const capacity = waitForDataChannelCapacity(
      dataChannel(channel),
      controller.signal,
      100,
      25,
    );

    // Prevent a broken implementation from leaving the test pending forever.
    channel.dispatchEvent(new Event("close"));

    await expect(capacity).rejects.toMatchObject({
      name: "AbortError",
      message: "Transfer cancelled",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
