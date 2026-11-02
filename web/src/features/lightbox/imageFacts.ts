import type { AppImage, PublicParam, PublicWorkflow } from "@comfy/shared";

export interface Fact {
  label: string;
  value: string;
}

/** The full prompt when the job recorded one, else the truncated summary. */
export function fullPrompt(image: AppImage): string {
  const recorded = image.params.prompt;
  return typeof recorded === "string" && recorded !== "" ? recorded : image.promptSummary;
}

/** The settings worth showing: workflow, size, seed, and any other plain value the job used. */
export function describeSettings(image: AppImage, workflow: PublicWorkflow | undefined): Fact[] {
  const facts: Fact[] = [{ label: "Workflow", value: workflow?.name ?? image.workflowId }];
  if (image.width && image.height) {
    facts.push({ label: "Size", value: `${image.width} × ${image.height}` });
  }
  if (image.seed !== null) facts.push({ label: "Seed", value: String(image.seed) });

  const skip = new Set(["prompt", "width", "height", "seed", "batch"]);
  for (const param of workflow?.params ?? []) {
    if (skip.has(param.id)) continue;
    const value = image.params[param.id];
    if (param.type === "modifiers") {
      const used = describeModifiers(param, value);
      facts.push({ label: param.label, value: used || "None" });
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      facts.push({ label: param.label, value: String(value) });
    }
  }
  return facts;
}

/** "Cinematic Shot 1, Fantasy Wizards & Witches 0.5" for the add-ons a result was made with. */
export function describeModifiers(
  param: Extract<PublicParam, { type: "modifiers" }>,
  value: unknown,
): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const { id, strength } = entry as { id?: unknown; strength?: unknown };
      const label = param.choices.find((choice) => choice.value === id)?.label;
      return label && typeof strength === "number" ? [`${label} ${strength}`] : [];
    })
    .join(", ");
}
