# Workflows

A workflow is a folder:

```
workflows/<id>/workflow.json   a ComfyUI graph exported with "Save (API Format)"
workflows/<id>/manifest.json   the few inputs people may change
```

The folder name must equal the manifest `id` (lowercase letters, digits, dashes). The server reads
the folder at startup and on `POST /api/workflows/refresh` (the **Re-check workflows** button).

Browsers never send a graph. They send `{ workflowId, values }`; the server writes each value into
the node input the manifest names and runs the result. Everything the manifest does not list is
locked exactly as exported.

## Exporting from ComfyUI

Enable dev mode in ComfyUI's settings, then use **Save (API Format)**. The ordinary **Save** writes
a different format that the server cannot run.

Keep exactly the outputs you want people to receive (a `SaveImage`, or a video save node). Preview
nodes also produce temporary files, and by default those are returned too. Delete previews,
comparers and sound notifiers from the exported graph, or add `"previews": false` to the manifest to
return only the files the workflow saved (previews are still used if it saved nothing).

## Manifest

```json
{
  "id": "krea2-turbo",
  "name": "Krea 2 Turbo",
  "description": "Shown on the Workflows page.",
  "kind": "txt2img",
  "params": [
    {
      "id": "prompt",
      "label": "Prompt",
      "type": "text",
      "default": "",
      "multiline": true,
      "target": { "nodeId": "90", "input": "text" }
    }
  ]
}
```

`kind` is one of `txt2img`, `img2img`, `upscale`, `i2v`, `t2v`. Add `"nsfw": true` to hide a
workflow unless a person turns NSFW content on.

Every param has `id`, `label`, `type`, and (except `modifiers` and optional booleans) a `target`.
`group`, `description` and `advanced` are optional; advanced params sit under "Advanced".

| `type`         | Extra fields                                                                         | The app shows                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `text`         | `default`, `multiline`, `maxLength`                                                  | The param with id `prompt` (or the first multiline text) becomes the prompt bar.                                             |
| `int`, `float` | `default`, `min`, `max`, `step`                                                      | A slider. A `width`/`height` pair becomes aspect-ratio chips; `batch` becomes the image count.                               |
| `enum`         | `default`, `choices: [{ value, label }]`                                             | Chips.                                                                                                                       |
| `seed`         | `default` (`-1` = random every run)                                                  | A number box with a Random button.                                                                                           |
| `boolean`      | `default`, optional `target`, optional `removeWhenOff` (node ids deleted when false) | A switch. Use `removeWhenOff` for an optional branch of the graph.                                                           |
| `image`        | `required`                                                                           | An upload. The server hands the image to ComfyUI itself.                                                                     |
| `images`       | `minCount`, `maxCount`, `encoder`, `uploadSubfolder`                                 | Several uploads.                                                                                                             |
| `modifiers`    | `choices`, `maxCount`, `strength`, `chain`                                           | Add-ons (LoRAs) chosen from a menu, each with a strength. The graph is stored without LoRA loaders; the server inserts them. |

A workflow shows **Needs attention** on the Workflows page when ComfyUI is missing one of its nodes
or model files.

## Video

Workflows whose output is a video work like image workflows: use `kind` `t2v` or `i2v` and end the
graph in a video save node. Clips appear in the feed and library with a duration badge, play
silently on hover, and open in a player. Keep clips short: results are stored on disk and served
with range requests.
