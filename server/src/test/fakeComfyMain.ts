import fs from "node:fs";
import path from "node:path";
import { createFakeComfy } from "./fakeComfy.js";
import { scriptSuccess } from "./harness.js";

// A stand-in for ComfyUI for demos, screenshots and the browser tests: it accepts any prompt and
// answers with a small picture. `npm run fake-comfy` starts it on FAKE_COMFY_PORT (default 8199).
const port = Number(process.env.FAKE_COMFY_PORT ?? 8199);
const objectInfoPath = path.resolve(import.meta.dirname, "objectInfo.example.json");

const comfy = await createFakeComfy(port);
comfy.objectInfo = JSON.parse(fs.readFileSync(objectInfoPath, "utf8")) as Record<string, unknown>;
await scriptSuccess(comfy);
console.log(`Fake ComfyUI listening on ${comfy.url}`);

const stop = (): void => {
  void comfy.close().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
