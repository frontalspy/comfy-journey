import type { PublicParam } from "@comfy/shared";
import { describe, expect, it } from "vitest";
import { describeModifiers } from "./imageFacts";

const param: Extract<PublicParam, { type: "modifiers" }> = {
  id: "loras",
  label: "LoRAs",
  type: "modifiers",
  advanced: false,
  default: [],
  maxCount: 3,
  strength: { min: 0, max: 1.5, step: 0.05, default: 1 },
  choices: [
    { value: "a", label: "Cinematic Shot" },
    { value: "b", label: "Dark Brush" },
  ],
};

describe("describeModifiers", () => {
  it("lists labels with strengths in the order used", () => {
    expect(
      describeModifiers(param, [
        { id: "b", strength: 0.5 },
        { id: "a", strength: 1 },
      ]),
    ).toBe("Dark Brush 0.5, Cinematic Shot 1");
  });

  it("ignores unknown ids and malformed entries, and non-lists", () => {
    expect(describeModifiers(param, [{ id: "zzz", strength: 1 }, null, { id: "a" }])).toBe("");
    expect(describeModifiers(param, "nope")).toBe("");
  });
});
