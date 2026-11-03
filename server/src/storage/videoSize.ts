export interface VideoSize {
  width: number;
  height: number;
}

const MAX_DEPTH = 4;
/** Boxes that only hold other boxes, on the way from the file to a track header. */
const CONTAINERS = new Set(["moov", "trak"]);

/**
 * The picture size of an MP4 or MOV, read from its track header (`tkhd`). No decoder is involved,
 * so a clip can be laid out at the right shape before it plays. Returns null for anything else
 * (WebM, Matroska) or for a file whose boxes do not add up; the clip is still stored as produced.
 */
export function readMp4Size(bytes: Uint8Array): VideoSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return findTrackSize(view, 0, view.byteLength, 0);
}

function findTrackSize(
  view: DataView,
  start: number,
  end: number,
  depth: number,
): VideoSize | null {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(
      ...new Uint8Array(view.buffer, view.byteOffset + offset + 4, 4),
    );
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return null;
    const bodyStart = offset + header;
    const bodyEnd = offset + size;
    if (type === "tkhd") {
      // Width and height are the last two 16.16 fixed-point numbers; audio tracks store 0 x 0.
      if (bodyEnd - bodyStart < 8) return null;
      const width = Math.round(view.getUint32(bodyEnd - 8) / 65536);
      const height = Math.round(view.getUint32(bodyEnd - 4) / 65536);
      if (width > 0 && height > 0) return { width, height };
    } else if (CONTAINERS.has(type) && depth < MAX_DEPTH) {
      const found = findTrackSize(view, bodyStart, bodyEnd, depth + 1);
      if (found) return found;
    }
    offset = bodyEnd;
  }
  return null;
}
