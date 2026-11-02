import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectOutputFiles, MAX_OUTPUTS_PER_JOB } from "../comfy/client.js";
import type { ComfyHistoryEntry } from "../comfy/types.js";
import { asUser, type UserClient } from "../test/asUser.js";
import { progressFrame } from "../test/fakeComfy.js";
import { ALICE, createHarness, type Harness, makePng } from "../test/harness.js";
import { submitJob, waitForStatus } from "../test/jobHelpers.js";
import { MESSAGES } from "./jobFailure.js";

let h: Harness;
let alice: UserClient;
beforeEach(async () => {
  h = await createHarness();
  alice = asUser(h, ALICE);
});
afterEach(async () => {
  await h.close();
});

type Ref = { filename: string; subfolder?: string; type?: string };

/** Makes every prompt finish with these node outputs; file bytes are served by name. */
async function scriptOutputs(
  outputs: Record<string, Record<string, unknown>>,
  files: Record<string, { mime: string; bytes?: Buffer }>,
): Promise<void> {
  const png = await makePng();
  for (const [name, file] of Object.entries(files)) {
    h.comfy.files.set(name, { mime: file.mime, bytes: file.bytes ?? png });
  }
  h.comfy.runScript = (promptId) => {
    h.comfy.history.set(promptId, {
      status: { status_str: "success", completed: true },
      outputs,
    });
    return [
      progressFrame(promptId, 1, 1),
      { type: "executing", data: { node: null, prompt_id: promptId } },
    ];
  };
}

async function runJob(): Promise<Record<string, unknown>> {
  const job = await submitJob(alice);
  return waitForStatus(alice, job.id, "done");
}

async function resultsOf(done: Record<string, unknown>) {
  const items = [];
  for (const id of done.imageIds as string[]) {
    items.push((await alice.get(`/api/images/${id}`)).body);
  }
  return items;
}

describe("collecting real ComfyUI output shapes", () => {
  it("asks /view for the type each file was listed with, temp previews included", async () => {
    await scriptOutputs(
      {
        "9": { images: [{ filename: "final.png", subfolder: "run", type: "output" }] },
        "12": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] },
      },
      { "final.png": { mime: "image/png" }, "preview.png": { mime: "image/png" } },
    );
    const done = await runJob();
    expect(done.imageIds).toHaveLength(2);
    expect(h.comfy.views).toEqual([
      { filename: "final.png", subfolder: "run", type: "output" },
      { filename: "preview.png", subfolder: "", type: "temp" },
    ]);
  });

  it("reads videos from a gifs key (VHS_VideoCombine) and stores them as video without a thumbnail", async () => {
    await scriptOutputs(
      {
        "20": {
          gifs: [{ filename: "clip.mp4", subfolder: "", type: "output", format: "video/h264-mp4" }],
        },
      },
      { "clip.mp4": { mime: "video/mp4", bytes: Buffer.from("not-really-an-mp4") } },
    );
    const [video] = await resultsOf(await runJob());
    expect(video).toMatchObject({
      kind: "video",
      mime: "video/mp4",
      hasThumb: false,
      width: null,
      source: "generated",
    });
  });

  it("stores a mix of images and one final video, thumbnails for images only", async () => {
    await scriptOutputs(
      {
        "9": {
          images: [
            { filename: "a.png", subfolder: "", type: "output" },
            { filename: "b.png", subfolder: "", type: "output" },
          ],
        },
        "30": { videos: [{ filename: "final.webm", subfolder: "v", type: "output" }] },
      },
      {
        "a.png": { mime: "image/png" },
        "b.png": { mime: "image/png" },
        "final.webm": { mime: "video/webm", bytes: Buffer.from("webm") },
      },
    );
    const items = await resultsOf(await runJob());
    expect(items.map((i) => [i.kind, i.hasThumb])).toEqual([
      ["image", true],
      ["image", true],
      ["video", false],
    ]);
  });

  it("classifies by file extension, whatever content type /view sends", async () => {
    await scriptOutputs(
      {
        "1": {
          images: [{ filename: "weird.png", subfolder: "", type: "output" }],
          gifs: [{ filename: "loop.mkv", subfolder: "", type: "output" }],
        },
      },
      {
        "weird.png": { mime: "application/octet-stream" },
        "loop.mkv": { mime: "application/octet-stream", bytes: Buffer.from("mkv") },
      },
    );
    const items = await resultsOf(await runJob());
    expect(items.map((i) => [i.kind, i.mime])).toEqual([
      ["image", "image/png"],
      ["video", "video/x-matroska"],
    ]);
  });

  it("ignores audio, animated flags and unknown files, and fails a job with nothing left", async () => {
    await scriptOutputs(
      {
        "1": {
          audio: [{ filename: "voice.flac", subfolder: "", type: "output" }],
          images: [{ filename: "notes.txt", subfolder: "", type: "output" }],
          animated: [true],
        },
      },
      { "voice.flac": { mime: "audio/flac" }, "notes.txt": { mime: "text/plain" } },
    );
    const job = await submitJob(alice);
    const failed = await waitForStatus(alice, job.id, "failed");
    expect(failed.error).toBe(MESSAGES.noOutput);
    expect(h.comfy.views).toEqual([]);
  });

  it("keeps audio out of a job that also made an image", async () => {
    await scriptOutputs(
      {
        "1": { audio: [{ filename: "voice.wav", subfolder: "", type: "output" }] },
        "9": { images: [{ filename: "a.png", subfolder: "", type: "output" }] },
      },
      { "voice.wav": { mime: "audio/wav" }, "a.png": { mime: "image/png" } },
    );
    expect((await runJob()).imageIds).toHaveLength(1);
  });

  it("stores a file listed twice only once", async () => {
    const ref = { filename: "dup.png", subfolder: "", type: "output" };
    await scriptOutputs(
      { "9": { images: [ref, ref] }, "10": { images: [ref] } },
      { "dup.png": { mime: "image/png" } },
    );
    expect((await runJob()).imageIds).toHaveLength(1);
    expect(h.comfy.views).toHaveLength(1);
  });

  it("caps the number of outputs one job keeps", async () => {
    const refs: Ref[] = Array.from({ length: MAX_OUTPUTS_PER_JOB + 4 }, (_, i) => ({
      filename: `o${i}.png`,
      subfolder: "",
      type: "output",
    }));
    const files = Object.fromEntries(refs.map((r) => [r.filename, { mime: "image/png" }]));
    await scriptOutputs({ "9": { images: refs } }, files);
    expect((await runJob()).imageIds).toHaveLength(MAX_OUTPUTS_PER_JOB);
  });

  it("skips a temp preview ComfyUI already cleaned up, but fails on a missing final output", async () => {
    await scriptOutputs(
      {
        "9": { images: [{ filename: "final.png", subfolder: "", type: "output" }] },
        "12": { images: [{ filename: "gone.png", subfolder: "", type: "temp" }] },
      },
      { "final.png": { mime: "image/png" } },
    );
    expect((await runJob()).imageIds).toHaveLength(1);

    await scriptOutputs(
      { "9": { images: [{ filename: "lost.png", subfolder: "", type: "output" }] } },
      {},
    );
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "failed");
  });
});

describe("collectOutputFiles", () => {
  const entry = (outputs: ComfyHistoryEntry["outputs"]): ComfyHistoryEntry => ({
    completed: true,
    statusStr: "success",
    outputs,
  });

  it("puts permanent outputs ahead of temp previews and drops input-type and unsafe refs", () => {
    const refs = collectOutputFiles(
      entry({
        "1": {
          images: [
            { filename: "p.png", subfolder: "", type: "temp" },
            { filename: "in.png", subfolder: "", type: "input" },
            { filename: "../escape.png", subfolder: "", type: "output" },
            { filename: "ok.png", subfolder: "..", type: "output" },
            { filename: "f.png", subfolder: "a/b", type: "output" },
          ],
        },
      }),
    );
    expect(refs).toEqual([
      { filename: "f.png", subfolder: "a/b", type: "output" },
      { filename: "p.png", subfolder: "", type: "temp" },
    ]);
  });
});

describe("collectOutputFiles with previews: false", () => {
  const entry = (outputs: ComfyHistoryEntry["outputs"]): ComfyHistoryEntry => ({
    completed: true,
    statusStr: "success",
    outputs,
  });
  const saved = { filename: "final.png", subfolder: "", type: "output" };
  const preview = { filename: "p.png", subfolder: "", type: "temp" };

  it("keeps only saved files when the run saved something", () => {
    const refs = collectOutputFiles(entry({ "1": { images: [preview, saved] } }), {
      previews: false,
    });
    expect(refs).toEqual([saved]);
  });

  it("falls back to previews when nothing was saved", () => {
    const refs = collectOutputFiles(entry({ "1": { images: [preview] } }), { previews: false });
    expect(refs).toEqual([preview]);
  });
});

describe("ComfyUI rejecting a workflow", () => {
  it("fails the job with a fixed message that carries none of ComfyUI's payload", async () => {
    h.comfy.rejectNextPrompt = {
      error: { type: "prompt_outputs_failed_validation", message: "SECRET-PATH C:\\models\\x" },
      node_errors: {
        "3": {
          class_type: "KSampler",
          errors: [{ type: "value_not_in_list", message: "bad", details: "secret-prompt-text" }],
        },
      },
    };
    const job = await submitJob(alice);
    const failed = await waitForStatus(alice, job.id, "failed");
    expect(failed.error).toBe(MESSAGES.rejected);
    expect(MESSAGES.rejected).toBe("The workflow was rejected by ComfyUI.");
    expect(JSON.stringify(failed)).not.toMatch(/SECRET|models|KSampler/);
  });
});
