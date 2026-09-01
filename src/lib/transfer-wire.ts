export const LOGICAL_CHUNK_SIZE = 256 * 1024;
export const DEFAULT_WIRE_PAYLOAD = 48 * 1024;
export const FRAME_HEADER_BYTES = 20;

export interface DecodedFrame {
  fileIndex: number;
  chunkIndex: number;
  offset: number;
  payload: ArrayBuffer;
}

export function encodeFrame(
  fileIndex: number,
  chunkIndex: number,
  offset: number,
  payload: ArrayBuffer,
): ArrayBuffer {
  const frame = new ArrayBuffer(FRAME_HEADER_BYTES + payload.byteLength);
  const view = new DataView(frame);
  view.setUint8(0, 1);
  view.setUint8(1, 1);
  view.setUint16(2, fileIndex);
  view.setUint32(4, chunkIndex);
  view.setBigUint64(8, BigInt(offset));
  view.setUint32(16, payload.byteLength);
  new Uint8Array(frame, FRAME_HEADER_BYTES).set(new Uint8Array(payload));
  return frame;
}

export function decodeFrame(frame: ArrayBuffer): DecodedFrame {
  if (frame.byteLength < FRAME_HEADER_BYTES) throw new Error("Frame is too short");
  const view = new DataView(frame);
  if (view.getUint8(0) !== 1 || view.getUint8(1) !== 1) {
    throw new Error("Unsupported transfer frame");
  }
  const payloadLength = view.getUint32(16);
  if (payloadLength !== frame.byteLength - FRAME_HEADER_BYTES) {
    throw new Error("Transfer frame length does not match its header");
  }
  const offset = Number(view.getBigUint64(8));
  if (!Number.isSafeInteger(offset)) throw new Error("Transfer offset is too large");
  return {
    fileIndex: view.getUint16(2),
    chunkIndex: view.getUint32(4),
    offset,
    payload: frame.slice(FRAME_HEADER_BYTES),
  };
}

export async function waitForDataChannelCapacity(
  channel: RTCDataChannel,
  signal?: AbortSignal,
  highWaterMark = 4 * 1024 * 1024,
  lowWaterMark = 1024 * 1024,
): Promise<void> {
  if (channel.readyState !== "open") throw new Error("The peer connection is not open");
  if (signal?.aborted) throw new DOMException("Transfer cancelled", "AbortError");
  if (channel.bufferedAmount <= highWaterMark) return;
  channel.bufferedAmountLowThreshold = lowWaterMark;

  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("The peer connection closed while sending"));
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Transfer cancelled", "AbortError"));
    };
    const poll = window.setInterval(() => {
      if (channel.bufferedAmount <= lowWaterMark) finish();
      else if (channel.readyState !== "open") fail();
    }, 100);
    const cleanup = () => {
      window.clearInterval(poll);
      channel.removeEventListener("bufferedamountlow", finish);
      channel.removeEventListener("close", fail);
      signal?.removeEventListener("abort", abort);
    };
    channel.addEventListener("bufferedamountlow", finish, { once: true });
    channel.addEventListener("close", fail, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
  });
}
