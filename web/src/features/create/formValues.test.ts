import { describe, expect, it } from "vitest";
import { exampleWorkflow } from "../../test/fixtures";
import {
  activeAspect,
  aspectOptions,
  coerceValue,
  defaultValues,
  mergeValues,
  missingRequirement,
  splitParams,
  valuesForSubmit,
} from "./formValues";

const [prompt, width, height, , seed] = exampleWorkflow.params;
if (!prompt || !width || !height || !seed) throw new Error("fixture changed");

describe("coerceValue", () => {
  it("clamps and rounds numbers, falls back on junk", () => {
    expect(coerceValue(width, 99999)).toBe(1536);
    expect(coerceValue(width, 700.4)).toBe(700);
    expect(coerceValue(width, "wide")).toBe(1024);
    expect(coerceValue(seed, -5)).toBe(-1);
    expect(coerceValue(seed, 42)).toBe(42);
    expect(coerceValue(prompt, 7)).toBe("");
  });

  it("keeps only known, unique modifiers within the limits", () => {
    const modifiers = {
      id: "mods",
      label: "Styles",
      type: "modifiers" as const,
      advanced: false,
      default: [],
      maxCount: 2,
      strength: { min: 0, max: 1, step: 0.1, default: 0.5 },
      choices: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
        { value: "c", label: "C" },
      ],
    };
    const result = coerceValue(modifiers, [
      { id: "a", strength: 4 },
      { id: "a", strength: 0.2 },
      { id: "zzz", strength: 0.2 },
      { id: "b" },
      { id: "c", strength: 0.1 },
    ]);
    expect(result).toEqual([
      { id: "a", strength: 1 },
      { id: "b", strength: 0.5 },
    ]);
  });
});

describe("mergeValues", () => {
  it("overlays remembered values on the defaults and ignores unknown keys", () => {
    const merged = mergeValues(exampleWorkflow, { prompt: "a cat", width: 640, nope: 1 });
    expect(merged).toMatchObject({ prompt: "a cat", width: 640, height: 1024, batch: 1, seed: -1 });
    expect(merged).not.toHaveProperty("nope");
  });

  it("starts from defaults for a missing or malformed record", () => {
    expect(mergeValues(exampleWorkflow, null)).toEqual(defaultValues(exampleWorkflow));
  });
});

describe("splitParams", () => {
  it("moves prompt, size and count out of the settings list", () => {
    const split = splitParams(exampleWorkflow);
    expect(split.prompt?.id).toBe("prompt");
    expect(split.width?.id).toBe("width");
    expect(split.batch?.id).toBe("batch");
    expect(split.rest.map((param) => param.id)).toEqual(["seed"]);
  });
});

describe("aspectOptions", () => {
  const split = splitParams(exampleWorkflow);
  const options = aspectOptions(split.width as never, split.height as never);

  it("keeps roughly the default pixel count and stays on the step grid", () => {
    for (const option of options) {
      expect(option.width % 64).toBe(0);
      expect(option.height % 64).toBe(0);
      expect(option.width * option.height).toBeGreaterThan(1024 * 1024 * 0.8);
      expect(option.width * option.height).toBeLessThan(1024 * 1024 * 1.2);
    }
  });

  it("finds the active option by size", () => {
    const wide = options.find((option) => option.label === "16:9");
    expect(wide).toBeDefined();
    expect(activeAspect(options, wide?.width ?? 0, wide?.height ?? 0)?.label).toBe("16:9");
    expect(activeAspect(options, 513, 777)).toBeUndefined();
  });
});

describe("submission", () => {
  it("asks for a prompt before anything else", () => {
    expect(missingRequirement(exampleWorkflow, defaultValues(exampleWorkflow))).toMatch(/Describe/);
    expect(missingRequirement(exampleWorkflow, { prompt: "a fox" })).toBeUndefined();
  });

  it("drops empty image slots", () => {
    const withImage = {
      ...exampleWorkflow,
      params: [
        ...exampleWorkflow.params,
        {
          id: "ref",
          label: "Ref",
          type: "image" as const,
          default: null,
          required: false,
          advanced: false,
        },
      ],
    };
    expect(
      valuesForSubmit(withImage, { ...defaultValues(withImage), ref: null }),
    ).not.toHaveProperty("ref");
  });
});

describe("an image-only workflow", () => {
  const upscaler = {
    ...exampleWorkflow,
    id: "upscale",
    kind: "upscale" as const,
    params: [
      {
        id: "image",
        label: "Image",
        type: "image" as const,
        default: null,
        required: true,
        advanced: false,
      },
    ],
  };

  it("has no prompt, and needs its image before it can be submitted", () => {
    expect(splitParams(upscaler).prompt).toBeUndefined();
    expect(missingRequirement(upscaler, { image: null })).toMatch(/Add an image/);
    expect(missingRequirement(upscaler, { image: "abc" })).toBeUndefined();
  });
});
