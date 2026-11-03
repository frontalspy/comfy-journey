import { describe, expect, it } from "vitest";
import { readMp4Size } from "./videoSize.js";

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

function tkhd(width: number, height: number): Uint8Array {
  const body = Buffer.alloc(84);
  body.writeUInt32BE(width * 65536, 76);
  body.writeUInt32BE(height * 65536, 80);
  return box("tkhd", body);
}

describe("readMp4Size", () => {
  it("reads the video track's size, skipping an audio track that is 0 x 0", () => {
    const file = Buffer.concat([
      box("ftyp", Buffer.from("isom")),
      box("moov", box("trak", tkhd(0, 0)), box("trak", tkhd(832, 480))),
      box("mdat", Buffer.alloc(16)),
    ]);
    expect(readMp4Size(file)).toEqual({ width: 832, height: 480 });
  });

  it("returns null for bytes that are not an MP4", () => {
    expect(readMp4Size(Buffer.from("not-really-an-mp4"))).toBeNull();
    expect(readMp4Size(Buffer.alloc(0))).toBeNull();
  });

  it("returns null when a box claims more bytes than the file holds", () => {
    const broken = box("moov", tkhd(640, 360)).subarray(0, 40);
    expect(readMp4Size(broken)).toBeNull();
  });
});
