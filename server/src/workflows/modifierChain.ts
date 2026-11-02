import type { ManifestParam } from "@comfy/shared";
import type { ComfyWorkflow } from "../comfy/types.js";

type ModifiersParam = Extract<ManifestParam, { type: "modifiers" }>;

export interface ChosenModifier {
  id: string;
  strength: number;
}

/**
 * Inserts one LoraLoader per chosen modifier, in order, between the chain's source and its
 * consumers. File names come from the manifest choice, never from the chosen value. Mutates the
 * (already cloned) workflow. Zero chosen wires the consumers straight to the source.
 */
export function insertModifierChain(
  workflow: ComfyWorkflow,
  param: ModifiersParam,
  chosen: readonly ChosenModifier[],
): void {
  let model: [string, number] = param.chain.model.from;
  let clip: [string, number] = param.chain.clip.from;
  chosen.forEach((modifier, index) => {
    const choice = param.choices.find((c) => c.value === modifier.id);
    if (!choice) throw new Error(`${param.id}: unknown modifier ${modifier.id}`);
    const nodeId = `mod_${index + 1}`;
    if (workflow[nodeId]) throw new Error(`${param.id}: node id ${nodeId} is already taken`);
    workflow[nodeId] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: choice.file,
        strength_model: modifier.strength,
        strength_clip: param.applyToClip ? modifier.strength : 0,
        model,
        clip,
      },
      _meta: { title: choice.label },
    };
    model = [nodeId, 0];
    clip = [nodeId, 1];
  });
  for (const [chain, end] of [
    [param.chain.model, model],
    [param.chain.clip, clip],
  ] as const) {
    for (const consumer of chain.consumers) {
      const node = workflow[consumer.nodeId];
      if (!node) throw new Error(`${param.id}: consumer node ${consumer.nodeId} is missing`);
      node.inputs[consumer.input] = [end[0], end[1]];
    }
  }
}
