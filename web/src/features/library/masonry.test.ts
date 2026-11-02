import { describe, expect, it } from "vitest";
import { columnsForWidth, distribute } from "./masonry";

describe("columnsForWidth", () => {
  it("follows the width within bounds", () => {
    expect(columnsForWidth(320)).toBe(2);
    expect(columnsForWidth(768)).toBe(3);
    expect(columnsForWidth(1280)).toBe(6);
    expect(columnsForWidth(5000)).toBe(8);
  });
});

describe("distribute", () => {
  it("fills the shortest column and keeps order within a column", () => {
    const tall = { id: "tall", ratio: 0.5 };
    const wide = { id: "wide", ratio: 2 };
    const lanes = distribute([tall, wide, wide, wide], 2, (item) => item.ratio);
    expect(lanes[0]?.map((i) => i.id)).toEqual(["tall"]);
    expect(lanes[1]?.map((i) => i.id)).toEqual(["wide", "wide", "wide"]);
  });

  it("does not move placed items when more are appended", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i, ratio: 1 + (i % 3) * 0.4 }));
    const before = distribute(items.slice(0, 8), 3, (i) => i.ratio);
    const after = distribute(items, 3, (i) => i.ratio);
    for (const [lane, placed] of before.entries()) {
      expect(after[lane]?.slice(0, placed.length)).toEqual(placed);
    }
  });
});
