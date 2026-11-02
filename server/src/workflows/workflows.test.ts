import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ManifestParam, publicWorkflowSchema, type WorkflowManifest } from "@comfy/shared";
import { describe, expect, it } from "vitest";
import type { ComfyObjectInfo, ComfyWorkflow } from "../comfy/types.js";
import { LIMITS } from "../limits.js";
import { applyParams, WorkflowParamsError } from "./applyParams.js";
import { checkWorkflowHealth } from "./health.js";
import { checkManifestTargets, loadWorkflows } from "./loader.js";
import { toPublicWorkflow } from "./toPublic.js";
import { buildValuesSchema } from "./valuesSchema.js";

type TextParam = Extract<ManifestParam, { type: "text" }>;

const FIXTURES = path.resolve(import.meta.dirname, "../test/fixtures");

async function fixture(): Promise<{
  manifest: WorkflowManifest;
  template: ComfyWorkflow;
  hash: string;
}> {
  const { workflows, problems } = await loadWorkflows(FIXTURES);
  expect(problems).toEqual([]);
  const loaded = workflows.find((w) => w.manifest.id === "fixture-txt2img");
  if (!loaded) throw new Error("fixture missing");
  return loaded;
}

describe("loadWorkflows", () => {
  it("loads the fixture and hashes its template", async () => {
    const { workflows } = await loadWorkflows(FIXTURES);
    expect(workflows.map((w) => w.manifest.id)).toEqual(["fixture-modifiers", "fixture-txt2img"]);
    expect(workflows[1]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns an empty list for an empty or missing directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-wf-"));
    expect(await loadWorkflows(dir)).toEqual({ workflows: [], problems: [] });
    expect(await loadWorkflows(path.join(dir, "nope"))).toEqual({ workflows: [], problems: [] });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports a broken folder without losing the good ones", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-wf-"));
    fs.cpSync(path.join(FIXTURES, "fixture-txt2img"), path.join(dir, "fixture-txt2img"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(dir, "broken"));
    fs.writeFileSync(path.join(dir, "broken", "manifest.json"), "{}");
    fs.writeFileSync(path.join(dir, "broken", "workflow.json"), "{}");
    const { workflows, problems } = await loadWorkflows(dir);
    expect(workflows).toHaveLength(1);
    expect(problems.map((p) => p.id)).toEqual(["broken"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("flags manifest targets that are not real nodes or inputs", async () => {
    const { manifest, template } = await fixture();
    const bad: WorkflowManifest = {
      ...manifest,
      params: [
        ...manifest.params,
        {
          ...(manifest.params[0] as TextParam),
          id: "ghost",
          target: { nodeId: "99", input: "text" },
        },
        {
          ...(manifest.params[0] as TextParam),
          id: "noinput",
          target: { nodeId: "6", input: "nope" },
        },
      ],
    };
    expect(checkManifestTargets(bad, template)).toEqual([
      "ghost: no node 99",
      "noinput: node 6 has no input nope",
    ]);
  });
});

describe("applyParams", () => {
  it("sets only exposed inputs, fills defaults and never mutates the template", async () => {
    const { manifest, template } = await fixture();
    const before = structuredClone(template);
    const { workflow, values } = applyParams(
      template,
      manifest,
      { prompt: "a dragon", steps: 30 },
      {
        random: () => 0.5,
      },
    );
    expect(template).toEqual(before);
    expect(workflow).not.toBe(template);
    expect(workflow["6"]?.inputs.text).toBe("a dragon");
    expect(workflow["3"]?.inputs.steps).toBe(30);
    expect(workflow["3"]?.inputs.seed).toBe(2 ** 31);
    expect(values.seed).toBe(2 ** 31);
    // Locked: the checkpoint and the wiring are untouched.
    expect(workflow["4"]).toEqual(template["4"]);
    expect(workflow["3"]?.inputs.positive).toEqual(["6", 0]);
    expect(workflow["5"]?.inputs.width).toBe(512);
  });

  it("keeps an explicit seed", async () => {
    const { manifest, template } = await fixture();
    expect(applyParams(template, manifest, { seed: 42 }).workflow["3"]?.inputs.seed).toBe(42);
  });

  it("rejects unknown ids, bad types, out-of-range numbers and unlisted enum values", async () => {
    const { manifest, template } = await fixture();
    const bad: Record<string, unknown>[] = [
      { checkpoint: "other.safetensors" },
      { steps: "20" },
      { steps: 0 },
      { cfg: 99 },
      { batch: 5 },
      { sampler: "../../etc/passwd" },
      { prompt: "x".repeat(LIMITS.maxPromptLength + 1) },
      { seed: -5 },
    ];
    for (const values of bad) {
      expect(() => applyParams(template, manifest, values), JSON.stringify(values)).toThrow(
        WorkflowParamsError,
      );
    }
  });

  it("enforces the global pixel ceiling across width and height", async () => {
    const { manifest, template } = await fixture();
    const wide: WorkflowManifest = {
      ...manifest,
      params: manifest.params.map((p) =>
        p.type === "int" && (p.id === "width" || p.id === "height") ? { ...p, max: 4096 } : p,
      ),
    };
    expect(() => applyParams(template, wide, { width: 4096, height: 4096 })).toThrow(/pixels/);
    expect(() => applyParams(template, wide, { width: 4096, height: 256 })).not.toThrow();
  });

  it("caps manifest bounds at the global limits", async () => {
    const { manifest, template } = await fixture();
    const greedy: WorkflowManifest = {
      ...manifest,
      params: manifest.params.map((p) =>
        p.type === "int" && p.id === "steps" ? { ...p, max: 10_000 } : p,
      ),
    };
    expect(() => applyParams(template, greedy, { steps: LIMITS.maxSteps + 1 })).toThrow();
    expect(() => applyParams(template, greedy, { steps: LIMITS.maxSteps })).not.toThrow();
  });

  it("handles boolean and image parameters", async () => {
    const { manifest, template } = await fixture();
    const extended: WorkflowManifest = {
      ...manifest,
      params: [
        ...manifest.params,
        {
          id: "tiled",
          label: "Tiled",
          type: "boolean",
          default: false,
          advanced: false,
          target: { nodeId: "3", input: "tiled" },
        },
        {
          id: "source",
          label: "Source",
          type: "image",
          default: null,
          required: true,
          advanced: false,
          target: { nodeId: "6", input: "image" },
        },
      ],
    };
    expect(() => applyParams(template, extended, {})).toThrow(/source/);
    const { workflow } = applyParams(template, extended, { tiled: true, source: "in.png" });
    expect(workflow["3"]?.inputs.tiled).toBe(true);
    expect(workflow["6"]?.inputs.image).toBe("in.png");
  });
});

describe("buildValuesSchema", () => {
  it("fills every default for an empty object", async () => {
    const { manifest } = await fixture();
    const parsed = buildValuesSchema(manifest).parse({});
    expect(parsed).toMatchObject({ steps: 20, sampler: "euler", seed: -1, batch: 1 });
  });
});

describe("toPublicWorkflow", () => {
  it("hides node targets and validates against the public schema", async () => {
    const { manifest } = await fixture();
    const dto = toPublicWorkflow(manifest, {
      available: false,
      unavailableReason: "Missing model",
    });
    expect(JSON.stringify(dto)).not.toContain("nodeId");
    expect(publicWorkflowSchema.parse(dto).unavailableReason).toBe("Missing model");
  });
});

describe("checkWorkflowHealth", () => {
  const info: ComfyObjectInfo = {
    KSampler: { input: { required: {} } },
    CLIPTextEncode: { input: { required: {} } },
    EmptyLatentImage: { input: { required: {} } },
    VAEDecode: { input: { required: {} } },
    SaveImage: { input: { required: {} } },
    CheckpointLoaderSimple: {
      input: { required: { ckpt_name: [["fixture-model.safetensors"], {}] } },
    },
  };

  it("passes when every class and model file exists", async () => {
    const { template } = await fixture();
    expect(checkWorkflowHealth(template, info)).toEqual({ ok: true, problems: [] });
  });

  it("flags a missing custom node and a missing model file", async () => {
    const { template } = await fixture();
    const { VAEDecode: _gone, ...withoutVae } = info;
    const wrongModel: ComfyObjectInfo = {
      ...withoutVae,
      CheckpointLoaderSimple: {
        input: { required: { ckpt_name: ["COMBO", { options: ["other.safetensors"] }] } },
      },
    };
    const health = checkWorkflowHealth(template, wrongModel);
    expect(health.ok).toBe(false);
    expect(health.problems).toEqual([
      "Missing model file fixture-model.safetensors (CheckpointLoaderSimple.ckpt_name)",
      "Missing node type VAEDecode",
    ]);
  });

  it("skips inputs the manifest exposes", async () => {
    const { template } = await fixture();
    const wrongModel: ComfyObjectInfo = {
      ...info,
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [["other"], {}] } } },
    };
    expect(
      checkWorkflowHealth(template, wrongModel, [{ nodeId: "4", input: "ckpt_name" }]).ok,
    ).toBe(true);
  });
});
