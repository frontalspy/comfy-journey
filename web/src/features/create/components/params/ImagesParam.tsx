import type { PublicParam } from "@comfy/shared";
import { useId, useState } from "react";
import { comfyApi } from "../../../../api/comfyApi";
import { Icon } from "../../../../components/Icon";
import { useToast } from "../../../../components/Toasts";

interface ImagesParamProps {
  param: Extract<PublicParam, { type: "image" | "images" }>;
  value: unknown;
  maxCount: number;
  /** One image: the value is an id or null, not a list. */
  single: boolean;
  onChange: (value: unknown) => void;
}

function idsOf(value: unknown, single: boolean): string[] {
  if (single) return typeof value === "string" ? [value] : [];
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** Reference images: uploaded here, then referenced by id. The server never sees a raw graph. */
export function ImagesParam({ param, value, maxCount, single, onChange }: ImagesParamProps) {
  const id = useId();
  const { notify } = useToast();
  const [uploading, setUploading] = useState(false);
  const ids = idsOf(value, single);

  function commit(next: string[]): void {
    onChange(single ? (next[0] ?? null) : next);
  }

  async function upload(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, maxCount - ids.length)) {
        added.push((await comfyApi.uploadImage(file)).id);
      }
      commit(single ? added.slice(0, 1) : [...ids, ...added]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Upload failed.", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="field">
      <span className="field-label" id={`${id}-label`}>
        {param.label}
      </span>
      <ul className="thumbs" aria-labelledby={`${id}-label`}>
        {ids.map((imageId) => (
          <li key={imageId} className="thumb">
            <img src={comfyApi.thumbUrl(imageId)} alt="" width={72} height={72} />
            <button
              type="button"
              aria-label="Remove image"
              onClick={() => commit(ids.filter((x) => x !== imageId))}
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {single || ids.length < maxCount ? (
        <label className="btn" style={{ alignSelf: "flex-start" }}>
          <Icon name="upload" size={18} />{" "}
          {uploading ? "Uploading…" : ids.length && single ? "Replace" : "Add image"}
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple={!single}
            disabled={uploading}
            onChange={(event) => {
              void upload(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
      {param.description ? <p className="field-hint">{param.description}</p> : null}
    </div>
  );
}
