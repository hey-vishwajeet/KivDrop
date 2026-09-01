import { describe, expect, it } from "vitest";
import {
  fileKind,
  formatBytes,
  formatCode,
  formatDuration,
  relativeExpiry,
} from "./format";

describe("formatBytes", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0])(
    "formats non-positive or non-finite value %s as zero bytes",
    (value) => {
      expect(formatBytes(value)).toBe("0 B");
    },
  );

  it.each([
    [1, "1 B"],
    [999, "999 B"],
    [1_024, "1.0 KB"],
    [1_536, "1.5 KB"],
    [100 * 1_024, "100 KB"],
    [1_024 ** 2, "1.0 MB"],
    [1_024 ** 3, "1.0 GB"],
    [1_024 ** 4, "1.0 TB"],
    [1_024 ** 5, "1024 TB"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("uses the requested precision below one hundred units", () => {
    expect(formatBytes(1_280, 2)).toBe("1.25 KB");
  });
});

describe("formatDuration", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1])(
    "uses an em dash for invalid duration %s",
    (seconds) => {
      expect(formatDuration(seconds)).toBe("—");
    },
  );

  it.each([
    [0, "less than a second"],
    [0.99, "less than a second"],
    [1, "1 sec"],
    [1.01, "2 sec"],
    [59, "59 sec"],
    [60, "1 min"],
    [61, "1 min 1 sec"],
    [120, "2 min"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe("formatCode", () => {
  it("keeps only the first six digits and groups a complete code", () => {
    expect(formatCode("12a34-56789")).toBe("123 456");
  });

  it.each([
    ["", ""],
    ["1", "1"],
    ["123", "123"],
    ["1234", "123 4"],
  ])("formats partial code %j as %j", (code, expected) => {
    expect(formatCode(code)).toBe(expected);
  });
});

describe("fileKind", () => {
  it.each([
    ["image/png", "photo.png", "Image"],
    ["video/mp4", "clip.mp4", "Video"],
    ["audio/mpeg", "song.mp3", "Audio"],
    ["application/pdf", "guide.pdf", "PDF"],
    ["application/zip", "archive.tar.gz", "GZ"],
    ["", "README", "File"],
    ["", ".gitignore", "GITIGNORE"],
  ])("classifies %s / %s as %s", (type, name, expected) => {
    expect(fileKind(type, name)).toBe(expected);
  });
});

describe("relativeExpiry", () => {
  const now = 1_000_000;

  it.each([
    [now - 1, "Expired"],
    [now, "Expired"],
    [now + 1, "0:01"],
    [now + 59_001, "1:00"],
    [now + 60_000, "1:00"],
    [now + 61_001, "1:02"],
    [now + 10 * 60_000, "10:00"],
  ])("formats expiry %d as %s", (expiresAt, expected) => {
    expect(relativeExpiry(expiresAt, now)).toBe(expected);
  });
});
