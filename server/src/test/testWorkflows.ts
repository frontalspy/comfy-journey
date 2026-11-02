import fs from "node:fs";
import path from "node:path";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");

interface Params {
  id: string;
  kind: string;
  nsfw: boolean;
}

/** A tiny graph with one image input and one output node ("9"), for the derived-job routes. */
function writeImageInputWorkflow(root: string, { id, kind, nsfw }: Params): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const template = {
    "1": { class_type: "LoadImage", inputs: { image: "placeholder.png" } },
    "3": { class_type: "KSampler", inputs: { seed: 0, steps: 10 } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "fixture", images: ["1", 0] } },
  };
  const manifest = {
    id,
    name: `Fixture ${kind}`,
    description: "TEST FIXTURE ONLY",
    kind,
    nsfw,
    params: [
      { id: "image", label: "Image", type: "image", target: { nodeId: "1", input: "image" } },
      {
        id: "prompt",
        label: "Prompt",
        type: "text",
        default: "again",
        target: { nodeId: "9", input: "filename_prefix" },
      },
      {
        id: "seed",
        label: "Seed",
        type: "seed",
        default: -1,
        target: { nodeId: "3", input: "seed" },
      },
    ],
  };
  fs.writeFileSync(path.join(dir, "workflow.json"), JSON.stringify(template));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
}

/** A graph whose only input is a list of reference images (the "images" parameter). */
function writeReferencesWorkflow(root: string): void {
  const dir = path.join(root, "fixture-refs");
  fs.mkdirSync(dir, { recursive: true });
  const template = {
    "5": { class_type: "FixtureMediaLoader", inputs: { media_state: "[]" } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "fixture", images: ["5", 0] } },
  };
  const manifest = {
    id: "fixture-refs",
    name: "Fixture references",
    description: "TEST FIXTURE ONLY",
    kind: "txt2img",
    nsfw: false,
    params: [
      {
        id: "refs",
        label: "References",
        type: "images",
        minCount: 0,
        maxCount: 3,
        encoder: "h3-media-state",
        uploadSubfolder: "comfy",
        target: { nodeId: "5", input: "media_state" },
      },
    ],
  };
  fs.writeFileSync(path.join(dir, "workflow.json"), JSON.stringify(template));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
}

/** Copies the committed txt2img fixture and generates the image-input and NSFW ones. */
export function writeTestWorkflows(parentDir: string): string {
  const root = path.join(parentDir, "test-workflows");
  fs.cpSync(path.join(FIXTURES, "fixture-txt2img"), path.join(root, "fixture-txt2img"), {
    recursive: true,
  });
  const nsfwDir = path.join(root, "fixture-nsfw");
  fs.cpSync(path.join(FIXTURES, "fixture-txt2img"), nsfwDir, { recursive: true });
  const manifestPath = path.join(nsfwDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, id: "fixture-nsfw", nsfw: true }));
  writeImageInputWorkflow(root, { id: "fixture-img2img", kind: "img2img", nsfw: false });
  writeImageInputWorkflow(root, { id: "fixture-upscale", kind: "upscale", nsfw: false });
  writeImageInputWorkflow(root, { id: "fixture-i2v", kind: "i2v", nsfw: false });
  writeReferencesWorkflow(root);
  return root;
}
