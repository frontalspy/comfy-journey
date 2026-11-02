import type { PublicParam, PublicWorkflow, WorkflowManifest } from "@comfy/shared";

/** One param without anything server-side: no target, chain, file names, encoder or removals. */
function toPublicParam(param: WorkflowManifest["params"][number]): PublicParam {
  switch (param.type) {
    case "modifiers": {
      const { chain: _chain, choices, ...rest } = param;
      return { ...rest, choices: choices.map(({ file: _file, ...choice }) => choice) };
    }
    case "images": {
      const { target: _target, encoder: _encoder, uploadSubfolder: _folder, ...rest } = param;
      return rest;
    }
    case "boolean": {
      const { target: _target, removeWhenOff: _removed, ...rest } = param;
      return rest;
    }
    default: {
      const { target: _target, ...rest } = param;
      return rest;
    }
  }
}

/** The browser's view of a workflow: the manifest without node targets, plus availability. */
export function toPublicWorkflow(
  manifest: WorkflowManifest,
  health: { available: boolean; unavailableReason: string | null },
): PublicWorkflow {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    kind: manifest.kind,
    nsfw: manifest.nsfw,
    preview: manifest.preview,
    params: manifest.params.map(toPublicParam),
    available: health.available,
    unavailableReason: health.unavailableReason,
  };
}
