import { describe, expect, it } from "vitest";
import { aspectRatio, formatBytes, formatDuration } from "./format";

describe("format", () => {
  it("formats durations as m:ss", () => {
    expect(formatDuration(5.2)).toBe("0:05");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(Number.NaN)).toBe("");
  });

  it("falls back to square without dimensions", () => {
    expect(aspectRatio(1920, 1080)).toBeCloseTo(16 / 9);
    expect(aspectRatio(null, 100)).toBe(1);
  });

  it("formats sizes", () => {
    expect(formatBytes(300)).toBe("1 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
