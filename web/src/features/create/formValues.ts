import type { PublicParam, PublicWorkflow } from "@comfy/shared";

export type FormValues = Record<string, unknown>;
type IntParam = Extract<PublicParam, { type: "int" }>;
type TextParam = Extract<PublicParam, { type: "text" }>;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function defaultValues(workflow: PublicWorkflow): FormValues {
  return Object.fromEntries(workflow.params.map((param) => [param.id, param.default]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value that is valid for the parameter, falling back to its default. Never trusts `raw`. */
export function coerceValue(param: PublicParam, raw: unknown): unknown {
  switch (param.type) {
    case "text":
      return typeof raw === "string" ? raw : param.default;
    case "int":
      return typeof raw === "number" && Number.isFinite(raw)
        ? clamp(Math.round(raw), param.min, param.max)
        : param.default;
    case "float":
      return typeof raw === "number" && Number.isFinite(raw)
        ? clamp(raw, param.min, param.max)
        : param.default;
    case "enum":
      return typeof raw === "string" && param.choices.some((choice) => choice.value === raw)
        ? raw
        : param.default;
    case "seed":
      return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= -1
        ? raw
        : param.default;
    case "boolean":
      return typeof raw === "boolean" ? raw : param.default;
    case "image":
      return typeof raw === "string" && raw !== "" ? raw : null;
    case "images":
      return Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === "string").slice(0, param.maxCount)
        : [];
    case "modifiers": {
      if (!Array.isArray(raw)) return param.default;
      const known = new Set(param.choices.map((choice) => choice.value));
      const seen = new Set<string>();
      const chosen: { id: string; strength: number }[] = [];
      for (const entry of raw) {
        if (!isRecord(entry) || typeof entry.id !== "string" || !known.has(entry.id)) continue;
        if (seen.has(entry.id) || chosen.length >= param.maxCount) continue;
        seen.add(entry.id);
        const strength =
          typeof entry.strength === "number" ? entry.strength : param.strength.default;
        chosen.push({
          id: entry.id,
          strength: clamp(strength, param.strength.min, param.strength.max),
        });
      }
      return chosen;
    }
  }
}

/** Defaults overlaid with whatever was remembered, each value validated. */
export function mergeValues(workflow: PublicWorkflow, stored: unknown): FormValues {
  const source = isRecord(stored) ? stored : {};
  return Object.fromEntries(
    workflow.params.map((param) => [
      param.id,
      param.id in source ? coerceValue(param, source[param.id]) : param.default,
    ]),
  );
}

export interface SplitParams {
  prompt: TextParam | undefined;
  width: IntParam | undefined;
  height: IntParam | undefined;
  batch: IntParam | undefined;
  /** Everything else, shown in the settings panel. */
  rest: PublicParam[];
}

/** Picks the parameters that live in the prompt bar and size chips; the rest go to settings. */
export function splitParams(workflow: PublicWorkflow): SplitParams {
  const texts = workflow.params.filter((param): param is TextParam => param.type === "text");
  const prompt = texts.find((param) => param.id === "prompt") ?? texts.find((p) => p.multiline);
  const ints = workflow.params.filter((param): param is IntParam => param.type === "int");
  const width = ints.find((param) => param.id === "width");
  const height = ints.find((param) => param.id === "height");
  const batch = ints.find((param) => param.id === "batch");
  const taken = new Set([
    prompt?.id,
    width && height ? width.id : undefined,
    width && height ? height.id : undefined,
    batch?.id,
  ]);
  return {
    prompt,
    width: width && height ? width : undefined,
    height: width && height ? height : undefined,
    batch,
    rest: workflow.params.filter((param) => !taken.has(param.id)),
  };
}

export interface AspectOption {
  label: string;
  width: number;
  height: number;
}

const RATIOS: readonly [number, number][] = [
  [1, 1],
  [3, 2],
  [4, 3],
  [16, 9],
  [2, 3],
  [3, 4],
  [9, 16],
];

function snap(value: number, param: IntParam): number {
  const step = param.step ?? 8;
  return clamp(Math.round(value / step) * step, param.min, param.max);
}

/** Aspect-ratio choices at roughly the workflow's default pixel count, snapped to its limits. */
export function aspectOptions(width: IntParam, height: IntParam): AspectOption[] {
  const area = width.default * height.default;
  return RATIOS.map(([a, b]) => {
    const ratio = a / b;
    const h = Math.sqrt(area / ratio);
    return { label: `${a}:${b}`, width: snap(h * ratio, width), height: snap(h, height) };
  });
}

export function activeAspect(
  options: readonly AspectOption[],
  width: number,
  height: number,
): AspectOption | undefined {
  return options.find((option) => option.width === width && option.height === height);
}

/** Values to send: every parameter, no empty image slots. */
export function valuesForSubmit(workflow: PublicWorkflow, values: FormValues): FormValues {
  const result: FormValues = {};
  for (const param of workflow.params) {
    const value = values[param.id];
    if (param.type === "image" && value === null) continue;
    result[param.id] = value;
  }
  return result;
}

/** A plain-language reason the form cannot be submitted yet, or undefined when it can. */
export function missingRequirement(
  workflow: PublicWorkflow,
  values: FormValues,
): string | undefined {
  for (const param of workflow.params) {
    const value = values[param.id];
    if (param.type === "text" && param.id === "prompt" && String(value ?? "").trim() === "") {
      return "Describe what you want to see.";
    }
    if (param.type === "image" && param.required && !value)
      return `Add an image for “${param.label}”.`;
    if (param.type === "images" && Array.isArray(value) && value.length < param.minCount) {
      return `Add at least ${param.minCount} images for “${param.label}”.`;
    }
  }
  return undefined;
}

/** The text of the prompt parameter, for display next to a job. */
export function promptText(workflow: PublicWorkflow | undefined, values: FormValues): string {
  const prompt = workflow ? splitParams(workflow).prompt : undefined;
  const value = prompt ? values[prompt.id] : undefined;
  return typeof value === "string" ? value : "";
}
