import path from "node:path";
import type { PublicWorkflow } from "@comfy/shared";
import type { ComfyClient } from "../comfy/client.js";
import { checkWorkflowHealth } from "./health.js";
import { type LoadedWorkflow, loadWorkflows } from "./loader.js";
import { allTargets } from "./paramTargets.js";
import { toPublicWorkflow } from "./toPublic.js";

interface Entry {
  loaded: LoadedWorkflow;
  available: boolean;
  unavailableReason: string | null;
}

export interface RegisteredWorkflow extends Entry {}

/**
 * The workflows on disk plus their health against ComfyUI's /object_info. If ComfyUI cannot be
 * asked (it is offline) health is unknown and the workflow stays available: jobs simply wait.
 * Workflows flagged nsfw are invisible everywhere when ALLOW_NSFW_WORKFLOWS is false.
 */
export class WorkflowRegistry {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly dir: string,
    private readonly comfy: Pick<ComfyClient, "objectInfo">,
    private readonly allowNsfw: boolean,
    private readonly log: Pick<Console, "warn"> = console,
  ) {}

  async refresh(): Promise<void> {
    const { workflows, problems } = await loadWorkflows(this.dir);
    for (const problem of problems) {
      this.log.warn(`[workflows] ${problem.id} skipped: ${problem.message}`);
    }
    const objectInfo = await this.comfy.objectInfo().catch(() => undefined);
    const next = new Map<string, Entry>();
    for (const loaded of workflows) {
      const health = objectInfo
        ? checkWorkflowHealth(
            loaded.template,
            objectInfo,
            allTargets(loaded.manifest.params),
            loaded.manifest.params,
          )
        : { ok: true, problems: [] };
      next.set(loaded.manifest.id, {
        loaded,
        available: health.ok,
        unavailableReason: health.ok ? null : health.problems.slice(0, 3).join("; "),
      });
    }
    this.entries = next;
  }

  /** What the picker shows: public DTOs only, never node targets. */
  list(): PublicWorkflow[] {
    return [...this.entries.values()]
      .filter((entry) => this.visible(entry))
      .map((entry) => toPublicWorkflow(entry.loaded.manifest, entry));
  }

  get(id: string): RegisteredWorkflow | undefined {
    const entry = this.entries.get(id);
    return entry && this.visible(entry) ? entry : undefined;
  }

  /** Absolute path of a workflow's preview image, or undefined when it has none. */
  previewPath(id: string): string | undefined {
    const preview = this.get(id)?.loaded.manifest.preview;
    if (!preview) return undefined;
    const name = path.basename(preview);
    if (!/.(png|jpe?g|webp|gif)$/i.test(name)) return undefined;
    return path.join(this.dir, id, name);
  }

  private visible(entry: Entry): boolean {
    return this.allowNsfw || !entry.loaded.manifest.nsfw;
  }
}
