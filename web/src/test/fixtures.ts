import type { PublicWorkflow } from "@comfy/shared";

/** A workflow shaped like the bundled example, for tests. */
export const exampleWorkflow: PublicWorkflow = {
  id: "example",
  name: "Example",
  description: "",
  kind: "txt2img",
  nsfw: false,
  available: true,
  unavailableReason: null,
  params: [
    { id: "prompt", label: "Prompt", type: "text", default: "", multiline: true, advanced: false },
    {
      id: "width",
      label: "Width",
      type: "int",
      default: 1024,
      min: 512,
      max: 1536,
      step: 64,
      advanced: false,
    },
    {
      id: "height",
      label: "Height",
      type: "int",
      default: 1024,
      min: 512,
      max: 1536,
      step: 64,
      advanced: false,
    },
    { id: "batch", label: "Images", type: "int", default: 1, min: 1, max: 8, advanced: false },
    { id: "seed", label: "Seed", type: "seed", default: -1, advanced: true },
  ],
};
