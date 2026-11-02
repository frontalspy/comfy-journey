import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type ManifestParam,
  type ParamTarget,
  type WorkflowManifest,
  workflowManifestSchema,
} from "@comfy/shared";
import { z } from "zod";
import type { ComfyWorkflow } from "../comfy/types.js";
import { paramTargets } from "./paramTargets.js";
import { buildValuesSchema } from "./valuesSchema.js";

export interface LoadedWorkflow {
  manifest: WorkflowManifest;
  template: ComfyWorkflow;
  /** sha256 of workflow.json, recorded on jobs so an old image can say what made it. */
  hash: string;
}

export interface WorkflowProblem {
  /** The folder name. */
  id: string;
  message: string;
}

export interface LoadResult {
  workflows: LoadedWorkflow[];
  /** Folders that failed validation; the rest still load. */
  problems: WorkflowProblem[];
}

export const comfyWorkflowSchema = z.record(
  z.string(),
  z.object({
    class_type: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()),
    _meta: z.object({ title: z.string().optional() }).passthrough().optional(),
  }),
);

type BooleanParam = Extract<ManifestParam, { type: "boolean" }>;
type ModifiersParam = Extract<ManifestParam, { type: "modifiers" }>;

function isLink(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number"
  );
}

function checkTarget(
  label: string,
  target: ParamTarget,
  template: ComfyWorkflow,
  issues: string[],
): void {
  const node = template[target.nodeId];
  if (!node) issues.push(`${label}: no node ${target.nodeId}`);
  else if (!(target.input in node.inputs)) {
    issues.push(`${label}: node ${target.nodeId} has no input ${target.input}`);
  }
}

/** After deleting the removable nodes, no node left may still read from one of them. */
function checkRemoval(param: BooleanParam, template: ComfyWorkflow, issues: string[]): void {
  const removed = new Set(param.removeWhenOff ?? []);
  for (const nodeId of removed) {
    if (!template[nodeId]) issues.push(`${param.id}: removeWhenOff node ${nodeId} does not exist`);
  }
  for (const [nodeId, node] of Object.entries(template)) {
    if (removed.has(nodeId)) continue;
    for (const value of Object.values(node.inputs)) {
      if (isLink(value) && removed.has(value[0])) {
        issues.push(`${param.id}: remaining node ${nodeId} reads removed node ${value[0]}`);
      }
    }
  }
}

function checkModifiers(param: ModifiersParam, template: ComfyWorkflow, issues: string[]): void {
  const files = new Set<string>();
  const values = new Set<string>();
  for (const choice of param.choices) {
    if (files.has(choice.file)) issues.push(`${param.id}: file used twice (${choice.label})`);
    if (values.has(choice.value)) issues.push(`${param.id}: duplicate choice ${choice.value}`);
    files.add(choice.file);
    values.add(choice.value);
  }
  for (const modifier of param.default) {
    if (!values.has(modifier.id))
      issues.push(`${param.id}: default ${modifier.id} is not a choice`);
  }
  for (const kind of ["model", "clip"] as const) {
    const chain = param.chain[kind];
    if (!template[chain.from[0]]) {
      issues.push(`${param.id}: ${kind} chain source ${chain.from[0]} missing`);
    }
    for (const consumer of chain.consumers) {
      checkTarget(`${param.id} ${kind} consumer`, consumer, template, issues);
    }
  }
}

function chainConsumers(param: ManifestParam): ParamTarget[] {
  return param.type === "modifiers"
    ? [...param.chain.model.consumers, ...param.chain.clip.consumers]
    : [];
}

/** Every target must name a real node and an input that node already has in the template. */
export function checkManifestTargets(
  manifest: WorkflowManifest,
  template: ComfyWorkflow,
): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const removable = new Set<string>();
  for (const param of manifest.params) {
    if (param.type === "boolean") for (const id of param.removeWhenOff ?? []) removable.add(id);
  }
  for (const param of manifest.params) {
    if (ids.has(param.id)) issues.push(`duplicate parameter id ${param.id}`);
    ids.add(param.id);
    if (param.type === "modifiers") checkModifiers(param, template, issues);
    else if (param.type === "boolean") {
      if (!param.target && (param.removeWhenOff ?? []).length === 0) {
        issues.push(`${param.id}: a boolean needs a target or removeWhenOff`);
      }
      if (param.target) checkTarget(param.id, param.target, template, issues);
      checkRemoval(param, template, issues);
    } else checkTarget(param.id, param.target, template, issues);
    for (const target of [...paramTargets(param), ...chainConsumers(param)]) {
      if (removable.has(target.nodeId)) {
        issues.push(`${param.id}: node ${target.nodeId} can be removed by a boolean`);
      }
    }
  }
  // Required images have no default; stand in for the stored image ids a job would supply.
  const probe: Record<string, unknown> = {};
  for (const param of manifest.params) {
    if (param.type === "image" && param.required) probe[param.id] = "probe-image";
    if (param.type === "images" && param.minCount > 0) {
      probe[param.id] = Array.from({ length: param.minCount }, () => "probe-image");
    }
  }
  const defaults = buildValuesSchema(manifest).safeParse(probe);
  if (!defaults.success) {
    for (const issue of defaults.error.issues) {
      issues.push(`defaults: ${issue.path.join(".")} ${issue.message}`);
    }
  }
  return issues;
}

async function loadOne(dir: string, id: string): Promise<LoadedWorkflow> {
  const [manifestText, workflowText] = await Promise.all([
    fs.readFile(path.join(dir, "manifest.json"), "utf8"),
    fs.readFile(path.join(dir, "workflow.json"), "utf8"),
  ]);
  const manifest = workflowManifestSchema.parse(JSON.parse(manifestText));
  if (manifest.id !== id) throw new Error(`manifest id ${manifest.id} does not match folder ${id}`);
  const template = comfyWorkflowSchema.parse(JSON.parse(workflowText)) as ComfyWorkflow;
  const issues = checkManifestTargets(manifest, template);
  if (issues.length > 0) throw new Error(issues.join("; "));
  return { manifest, template, hash: createHash("sha256").update(workflowText).digest("hex") };
}

/**
 * Reads `<root>/<id>/{workflow.json,manifest.json}`. A missing or empty directory yields no
 * workflows; a broken folder is reported in `problems` instead of failing the rest.
 */
export async function loadWorkflows(root: string): Promise<LoadResult> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { workflows: [], problems: [] };
    throw err;
  }
  const result: LoadResult = { workflows: [], problems: [] };
  for (const entry of entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      result.workflows.push(await loadOne(path.join(root, entry.name), entry.name));
    } catch (err) {
      const message =
        err instanceof z.ZodError
          ? err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")
          : String(err instanceof Error ? err.message : err);
      result.problems.push({ id: entry.name, message });
    }
  }
  return result;
}
