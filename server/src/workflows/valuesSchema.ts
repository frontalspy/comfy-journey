import type { ManifestParam, WorkflowManifest } from "@comfy/shared";
import { z } from "zod";
import { LIMITS } from "../limits.js";
import { resolvedImageSchema } from "./resolvedImages.js";

/** Global ceilings by the ComfyUI input a parameter targets; no manifest bound can exceed them. */
const INPUT_CEILINGS: Readonly<Record<string, number>> = {
  steps: LIMITS.maxSteps,
  batch_size: LIMITS.maxBatch,
  width: LIMITS.maxDimension,
  height: LIMITS.maxDimension,
  length: LIMITS.maxFrames,
  frames: LIMITS.maxFrames,
  video_frames: LIMITS.maxFrames,
};

const MAX_SEED = Number.MAX_SAFE_INTEGER;

export interface ValuesSchemaOptions {
  /**
   * "ids" (default, a client request): `images` values are stored image ids.
   * "resolved" (applyParams, after the worker uploaded them): ResolvedImage objects.
   */
  images?: "ids" | "resolved";
}

function targetInput(param: ManifestParam): string | undefined {
  return "target" in param ? param.target?.input : undefined;
}

function ceiling(param: ManifestParam, declared: number): number {
  const input = targetInput(param);
  return Math.min(declared, (input && INPUT_CEILINGS[input]) || Number.POSITIVE_INFINITY);
}

function modifiersSchema(param: Extract<ManifestParam, { type: "modifiers" }>): z.ZodTypeAny {
  const known = new Set(param.choices.map((choice) => choice.value));
  return z
    .array(
      z
        .object({
          id: z.string().min(1).max(64),
          strength: z.number().min(param.strength.min).max(param.strength.max),
        })
        .strict(),
    )
    .max(param.maxCount)
    .superRefine((chosen, ctx) => {
      const seen = new Set<string>();
      chosen.forEach((modifier, index) => {
        if (!known.has(modifier.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "id"],
            message: "Unknown modifier",
          });
        } else if (seen.has(modifier.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "id"],
            message: "Modifier chosen twice",
          });
        }
        seen.add(modifier.id);
      });
    })
    .default(param.default);
}

/** The schema for one parameter's value. Defaults are applied here. */
export function paramValueSchema(
  param: ManifestParam,
  options: ValuesSchemaOptions = {},
): z.ZodTypeAny {
  switch (param.type) {
    case "text": {
      const max = Math.min(param.maxLength ?? LIMITS.maxPromptLength, LIMITS.maxPromptLength);
      return z.string().max(max).default(param.default);
    }
    case "int":
      return z.number().int().min(param.min).max(ceiling(param, param.max)).default(param.default);
    case "float":
      return z.number().min(param.min).max(ceiling(param, param.max)).default(param.default);
    case "enum": {
      const values = param.choices.map((choice) => choice.value) as [string, ...string[]];
      return z.enum(values).default(param.default);
    }
    case "seed":
      // -1 asks for a fresh random seed on every run.
      return z.union([z.literal(-1), z.number().int().min(0).max(MAX_SEED)]).default(param.default);
    case "boolean":
      return z.boolean().default(param.default);
    case "image": {
      const id = z.string().min(1).max(200);
      return param.required ? id : id.optional();
    }
    case "modifiers":
      return modifiersSchema(param);
    case "images": {
      const item = options.images === "resolved" ? resolvedImageSchema : z.string().min(1).max(200);
      return z.array(item).min(param.minCount).max(param.maxCount).default(param.default);
    }
  }
}

/**
 * The strict schema for a workflow's `values`: unknown ids are rejected, every value is checked
 * against its manifest bounds and the global limits, and missing values take their defaults.
 * Ownership of image ids is checked by the worker, not here.
 */
export function buildValuesSchema(
  manifest: WorkflowManifest,
  options: ValuesSchemaOptions = {},
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const param of manifest.params) shape[param.id] = paramValueSchema(param, options);
  const widthId = manifest.params.find((p) => targetInput(p) === "width")?.id;
  const heightId = manifest.params.find((p) => targetInput(p) === "height")?.id;
  return z
    .object(shape)
    .strict()
    .superRefine((values, ctx) => {
      if (!widthId || !heightId) return;
      const pixels = Number(values[widthId]) * Number(values[heightId]);
      if (pixels > LIMITS.maxPixels) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [heightId],
          message: `Image is larger than ${LIMITS.maxPixels} pixels`,
        });
      }
    }) as z.ZodType<Record<string, unknown>>;
}
