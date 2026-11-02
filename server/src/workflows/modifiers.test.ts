import fs from "node:fs";
import path from "node:path";
import { type ManifestParam, publicWorkflowSchema, type WorkflowManifest } from "@comfy/shared";
import { describe, expect, it } from "vitest";
import type { ComfyObjectInfo, ComfyWorkflow } from "../comfy/types.js";
import { applyParams, WorkflowParamsError } from "./applyParams.js";
import { checkWorkflowHealth } from "./health.js";
import { checkManifestTargets, loadWorkflows } from "./loader.js";
import { allTargets } from "./paramTargets.js";
import type { ResolvedImage } from "./resolvedImages.js";
import { toPublicWorkflow } from "./toPublic.js";

const FIXTURES = path.resolve(import.meta.dirname, "../test/fixtures");
const REAL = path.resolve(import.meta.dirname, "../../../workflows");

interface Loaded {
  manifest: WorkflowManifest;
  template: ComfyWorkflow;
}

async function load(root: string, id: string): Promise<Loaded> {
  const { workflows } = await loadWorkflows(root);
  const found = workflows.find((w) => w.manifest.id === id);
  if (!found) throw new Error(`${id} missing`);
  return found;
}

const fixture = (): Promise<Loaded> => load(FIXTURES, "fixture-modifiers");

function isAcyclic(workflow: ComfyWorkflow): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return true;
    if (state.get(id) === 1) return false;
    state.set(id, 1);
    for (const value of Object.values(workflow[id]?.inputs ?? {})) {
      const target = Array.isArray(value) ? value[0] : undefined;
      if (typeof target === "string" && workflow[target] && !visit(target)) return false;
    }
    state.set(id, 2);
    return true;
  };
  return Object.keys(workflow).every(visit);
}

function patchParam(
  manifest: WorkflowManifest,
  id: string,
  patch: (param: ManifestParam) => unknown,
): WorkflowManifest {
  return {
    ...manifest,
    params: manifest.params.map((p) => (p.id === id ? (patch(p) as ManifestParam) : p)),
  };
}

describe("modifiers", () => {
  it("zero modifiers wire consumers straight to the source", async () => {
    const { manifest, template } = await fixture();
    const { workflow } = applyParams(template, manifest, { modifiers: [] });
    expect(workflow.mod_1).toBeUndefined();
    expect(workflow["3"]?.inputs.model).toEqual(["4", 0]);
    expect(workflow["6"]?.inputs.clip).toEqual(["4", 1]);
    expect(workflow["7"]?.inputs.clip).toEqual(["4", 1]);
  });

  it("one modifier inserts one loader between source and consumers", async () => {
    const { manifest, template } = await fixture();
    const { workflow } = applyParams(template, manifest, {
      modifiers: [{ id: "beta", strength: 0.7 }],
    });
    expect(workflow.mod_1?.class_type).toBe("LoraLoader");
    expect(workflow.mod_1?.inputs).toMatchObject({
      lora_name: "beta-lora.safetensors",
      strength_model: 0.7,
      strength_clip: 0.7,
      model: ["4", 0],
      clip: ["4", 1],
    });
    expect(workflow["3"]?.inputs.model).toEqual(["mod_1", 0]);
    expect(workflow["6"]?.inputs.clip).toEqual(["mod_1", 1]);
    expect(workflow["7"]?.inputs.clip).toEqual(["mod_1", 1]);
    expect(isAcyclic(workflow)).toBe(true);
  });

  it("three modifiers chain in the order chosen", async () => {
    const { manifest, template } = await fixture();
    const { workflow } = applyParams(template, manifest, {
      modifiers: [
        { id: "gamma", strength: 0.1 },
        { id: "alpha", strength: 1 },
        { id: "beta", strength: 1.5 },
      ],
    });
    expect(workflow.mod_1?.inputs).toMatchObject({
      lora_name: "gamma-lora.safetensors",
      model: ["4", 0],
      clip: ["4", 1],
    });
    expect(workflow.mod_2?.inputs).toMatchObject({
      lora_name: "alpha-lora.safetensors",
      model: ["mod_1", 0],
      clip: ["mod_1", 1],
    });
    expect(workflow.mod_3?.inputs).toMatchObject({
      lora_name: "beta-lora.safetensors",
      strength_model: 1.5,
      model: ["mod_2", 0],
      clip: ["mod_2", 1],
    });
    expect(workflow["3"]?.inputs.model).toEqual(["mod_3", 0]);
    expect(workflow["6"]?.inputs.clip).toEqual(["mod_3", 1]);
    expect(workflow["7"]?.inputs.clip).toEqual(["mod_3", 1]);
    expect(isAcyclic(workflow)).toBe(true);
  });

  it("does not mutate the template", async () => {
    const { manifest, template } = await fixture();
    const before = structuredClone(template);
    applyParams(template, manifest, { modifiers: [{ id: "alpha", strength: 1 }] });
    expect(template).toEqual(before);
  });

  it("rejects duplicate, unknown, extra-field, out-of-range and too many modifiers", async () => {
    const { manifest, template } = await fixture();
    const bad: unknown[] = [
      [
        { id: "alpha", strength: 1 },
        { id: "alpha", strength: 0.5 },
      ],
      [{ id: "alpha-lora.safetensors", strength: 1 }],
      [{ id: "nope", strength: 1 }],
      [{ id: "alpha", strength: 1, file: "../../evil.safetensors" }],
      [{ id: "alpha", strength: 2 }],
      [{ id: "alpha", strength: -0.1 }],
      [
        { id: "alpha", strength: 1 },
        { id: "beta", strength: 1 },
        { id: "gamma", strength: 1 },
        { id: "alpha", strength: 1 },
      ],
      "alpha",
    ];
    for (const modifiers of bad) {
      expect(
        () => applyParams(template, manifest, { modifiers }),
        JSON.stringify(modifiers),
      ).toThrow(WorkflowParamsError);
    }
  });

  it("only ever writes file names from the manifest into the graph", async () => {
    const { manifest, template } = await fixture();
    const { workflow, values } = applyParams(template, manifest, {
      modifiers: [{ id: "alpha", strength: 1 }],
    });
    expect(
      Object.values(workflow)
        .filter((node) => node.class_type === "LoraLoader")
        .map((node) => node.inputs.lora_name),
    ).toEqual(["alpha-lora.safetensors"]);
    expect(values.modifiers).toEqual([{ id: "alpha", strength: 1 }]);
  });
});

describe("images", () => {
  const picture = (n: number): ResolvedImage => ({
    file: `comfy/ref-${n}.png`,
    name: `ref ${n}.png`,
    width: 640,
    height: 480,
  });

  it("encodes the h3 media state with the format MiniMax reads", async () => {
    const { manifest, template } = await fixture();
    const { workflow } = applyParams(
      template,
      manifest,
      { references: [picture(1), { ...picture(2), width: null, height: null }] },
      { random: () => 0.5 },
    );
    const state = JSON.parse(String(workflow["20"]?.inputs.media_state));
    expect(state).toEqual([
      {
        kind: "picture",
        file: "comfy/ref-1.png [input]",
        name: "ref 1.png",
        duration: null,
        width: 640,
        height: 480,
        has_audio: false,
        audio_mode: "off",
        uid: expect.stringMatching(/^mm[0-9a-z]{8}$/),
      },
      expect.objectContaining({ file: "comfy/ref-2.png [input]", width: null, height: null }),
    ]);
  });

  it("gives each picture a different uid with a real random source", async () => {
    const { manifest, template } = await fixture();
    const { workflow } = applyParams(template, manifest, { references: [picture(1), picture(2)] });
    const state = JSON.parse(String(workflow["20"]?.inputs.media_state)) as { uid: string }[];
    expect(state[0]?.uid).not.toBe(state[1]?.uid);
  });

  it("leaves an empty list as an empty state and rejects bad lists", async () => {
    const { manifest, template } = await fixture();
    expect(applyParams(template, manifest, {}).workflow["20"]?.inputs.media_state).toBe("[]");
    const bad: unknown[] = [
      [picture(1), picture(2), picture(3), picture(4)],
      ["image-id"],
      [{ ...picture(1), extra: true }],
      "comfy/x.png",
    ];
    for (const references of bad) {
      expect(
        () => applyParams(template, manifest, { references }),
        JSON.stringify(references),
      ).toThrow(WorkflowParamsError);
    }
  });
});

describe("removeWhenOff", () => {
  it("deletes the listed nodes when false and keeps them when true", async () => {
    const { manifest, template } = await fixture();
    const off = applyParams(template, manifest, { upscaled: false }).workflow;
    expect(off["30"]).toBeUndefined();
    expect(off["31"]).toBeUndefined();
    expect(off["9"]).toBeDefined();
    const on = applyParams(template, manifest, { upscaled: true }).workflow;
    expect(on["30"]).toEqual(template["30"]);
    expect(on["31"]).toEqual(template["31"]);
  });

  it("still sets the optional target when present", async () => {
    const { manifest, template } = await fixture();
    const withTarget = patchParam(manifest, "upscaled", (p) => ({
      ...p,
      target: { nodeId: "30", input: "scale_by" },
    }));
    expect(
      applyParams(template, withTarget, { upscaled: true }).workflow["30"]?.inputs.scale_by,
    ).toBe(true);
  });
});

describe("loader checks", () => {
  it("accepts the fixture", async () => {
    const { manifest, template } = await fixture();
    expect(checkManifestTargets(manifest, template)).toEqual([]);
  });

  it("rejects a removal that leaves a dangling reference", async () => {
    const { manifest, template } = await fixture();
    const bad = patchParam(manifest, "upscaled", (p) => ({ ...p, removeWhenOff: ["30"] }));
    expect(checkManifestTargets(bad, template)).toEqual([
      "upscaled: remaining node 31 reads removed node 30",
    ]);
  });

  it("rejects removing a missing node, and a boolean with nothing to do", async () => {
    const { manifest, template } = await fixture();
    const ghost = patchParam(manifest, "upscaled", (p) => ({
      ...p,
      removeWhenOff: ["30", "31", "77"],
    }));
    expect(checkManifestTargets(ghost, template)).toContain(
      "upscaled: removeWhenOff node 77 does not exist",
    );
    const empty = patchParam(manifest, "upscaled", (p) => ({ ...p, removeWhenOff: [] }));
    expect(checkManifestTargets(empty, template)).toContain(
      "upscaled: a boolean needs a target or removeWhenOff",
    );
  });

  it("rejects a parameter that targets a node a boolean can remove", async () => {
    const { manifest, template } = await fixture();
    const bad = patchParam(manifest, "references", (p) => ({
      ...p,
      target: { nodeId: "30", input: "scale_by" },
    }));
    expect(checkManifestTargets(bad, template)).toContain(
      "references: node 30 can be removed by a boolean",
    );
  });

  it("rejects bad modifier chains, duplicate files and unknown defaults", async () => {
    const { manifest, template } = await fixture();
    const bad = patchParam(manifest, "modifiers", (p) => {
      if (p.type !== "modifiers") return p;
      const [first, second, third] = p.choices;
      return {
        ...p,
        default: [{ id: "ghost", strength: 0.5 }],
        choices: [first, { ...second, file: first?.file }, third],
        chain: {
          model: { from: ["99", 0], consumers: [{ nodeId: "3", input: "nope" }] },
          clip: p.chain.clip,
        },
      };
    });
    const issues = checkManifestTargets(bad, template).join("\n");
    expect(issues).toContain("file used twice");
    expect(issues).toContain("default ghost is not a choice");
    expect(issues).toContain("model chain source 99 missing");
    expect(issues).toContain("node 3 has no input nope");
  });

  it("rejects a missing images target", async () => {
    const { manifest, template } = await fixture();
    const bad = patchParam(manifest, "references", (p) => ({
      ...p,
      target: { nodeId: "55", input: "media_state" },
    }));
    expect(checkManifestTargets(bad, template)).toContain("references: no node 55");
  });
});

describe("public DTO", () => {
  it("exposes modifiers and images without files, chain or targets", async () => {
    const { manifest } = await fixture();
    const dto = toPublicWorkflow(manifest, { available: true, unavailableReason: null });
    const json = JSON.stringify(dto);
    for (const secret of [
      "nodeId",
      "chain",
      "safetensors",
      "removeWhenOff",
      "h3-media-state",
      "comfy",
    ]) {
      expect(json, secret).not.toContain(secret);
    }
    const parsed = publicWorkflowSchema.parse(dto);
    expect(parsed.params.map((p) => p.type)).toEqual([
      "text",
      "seed",
      "modifiers",
      "images",
      "boolean",
    ]);
    const modifiers = dto.params.find((p) => p.type === "modifiers");
    expect(modifiers?.type === "modifiers" && modifiers.choices.map((c) => c.value)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });
});

describe("health with modifiers", () => {
  const info = (loras: string[]): ComfyObjectInfo => ({
    KSampler: { input: { required: {} } },
    CLIPTextEncode: { input: { required: {} } },
    EmptyLatentImage: { input: { required: {} } },
    VAEDecode: { input: { required: {} } },
    SaveImage: { input: { required: {} } },
    PreviewImage: { input: { required: {} } },
    ImageScaleBy: { input: { required: {} } },
    FixtureMediaLoader: { input: { required: {} } },
    CheckpointLoaderSimple: {
      input: { required: { ckpt_name: [["fixture-model.safetensors"], {}] } },
    },
    LoraLoader: { input: { required: { lora_name: [loras, {}] } } },
  });
  const all = ["alpha-lora.safetensors", "beta-lora.safetensors", "gamma-lora.safetensors"];

  it("passes when every LoRA is installed", async () => {
    const { manifest, template } = await fixture();
    const health = checkWorkflowHealth(
      template,
      info(all),
      allTargets(manifest.params),
      manifest.params,
    );
    expect(health.ok).toBe(true);
  });

  it("names the modifier label, not the file, when a LoRA is missing", async () => {
    const { manifest, template } = await fixture();
    const health = checkWorkflowHealth(
      template,
      info(["alpha-lora.safetensors"]),
      allTargets(manifest.params),
      manifest.params,
    );
    expect(health.ok).toBe(false);
    expect(health.problems).toEqual([
      'Modifier "Beta" is not installed',
      'Modifier "Gamma" is not installed',
    ]);
    expect(health.problems.join()).not.toContain("safetensors");
  });

  it("flags a missing LoraLoader node type", async () => {
    const { manifest, template } = await fixture();
    const { LoraLoader: _gone, ...without } = info(all);
    expect(checkWorkflowHealth(template, without, [], manifest.params).problems).toEqual([
      "Missing node type LoraLoader",
    ]);
  });
});

describe("the bundled workflows", () => {
  const objectInfo = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, "../test/objectInfo.example.json"), "utf8"),
  ) as ComfyObjectInfo;

  it("loads every bundled workflow with no problems", async () => {
    const { workflows, problems } = await loadWorkflows(REAL);
    expect(problems).toEqual([]);
    expect(workflows.map((w) => w.manifest.id)).toEqual(["krea2-turbo"]);
  });

  it("is healthy against the node and model lists it names", async () => {
    const { manifest, template } = await load(REAL, "krea2-turbo");
    const health = checkWorkflowHealth(
      template,
      objectInfo,
      allTargets(manifest.params),
      manifest.params,
    );
    expect(health).toEqual({ ok: true, problems: [] });
  });

  it("reports a missing model file by name", async () => {
    const { manifest, template } = await load(REAL, "krea2-turbo");
    const missing: ComfyObjectInfo = {
      ...objectInfo,
      UNETLoader: { input: { required: { unet_name: [["something-else.safetensors"], {}] } } },
    };
    const health = checkWorkflowHealth(template, missing, allTargets(manifest.params));
    expect(health.ok).toBe(false);
    expect(health.problems.join(" ")).toContain("krea2_turbo_fp8_scaled.safetensors");
  });

  it("krea2-turbo: sets only the prompt, size, batch and seed and keeps the rest locked", async () => {
    const { manifest, template } = await load(REAL, "krea2-turbo");
    const { workflow, values } = applyParams(
      template,
      manifest,
      { prompt: "a knight", width: 768, height: 1280, batch: 3 },
      { random: () => 0.5 },
    );
    expect(workflow["90"]?.inputs.text).toBe("a knight");
    expect(workflow["88"]?.inputs).toMatchObject({ width: 768, height: 1280, batch_size: 3 });
    expect(workflow["89"]?.inputs.seed).toBe(values.seed);
    expect(workflow["89"]?.inputs.steps).toBe(template["89"]?.inputs.steps);
    expect(workflow["93"]).toEqual(template["93"]);
    expect(() => applyParams(template, manifest, { width: 4096 })).toThrow(WorkflowParamsError);
  });
});
