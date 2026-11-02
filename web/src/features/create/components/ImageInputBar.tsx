import { type FormEvent, useId, useState } from "react";
import { comfyApi } from "../../../api/comfyApi";
import { Icon } from "../../../components/Icon";
import { useToast } from "../../../components/Toasts";

interface ImageInputBarProps {
  /** The stored image id chosen so far, if any. */
  imageId: string | null;
  onImageChange: (imageId: string | null) => void;
  onSubmit: () => void;
  onOpenSettings: () => void;
  /** Why creating is not possible right now, shown as the button's tooltip. */
  blocker: string | undefined;
  submitting: boolean;
  submitLabel: string;
  /** One line under the bar, e.g. "Upscale · 8.85 megapixels". */
  summary: string;
}

/** The Create bar for workflows that start from a picture instead of a description. */
export function ImageInputBar({
  imageId,
  onImageChange,
  onSubmit,
  onOpenSettings,
  blocker,
  submitting,
  submitLabel,
  summary,
}: ImageInputBarProps) {
  const inputId = useId();
  const hintId = useId();
  const { notify } = useToast();
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      onImageChange((await comfyApi.uploadImage(file)).id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Upload failed.", "error");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!blocker && !submitting && !uploading) onSubmit();
  }

  return (
    <div className="prompt-bar-wrap">
      <form className="prompt-bar" onSubmit={handleSubmit} aria-label="Create">
        <label className="image-pick" htmlFor={inputId}>
          {imageId ? (
            <img src={comfyApi.thumbUrl(imageId)} alt="" width={44} height={44} />
          ) : (
            <Icon name="upload" />
          )}
          <span>
            {uploading ? "Uploading…" : imageId ? "Change image" : "Choose an image to work on"}
          </span>
          <input
            id={inputId}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploading}
            aria-describedby={hintId}
            onChange={(event) => {
              void upload(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        {imageId ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove image"
            onClick={() => onImageChange(null)}
          >
            <Icon name="close" />
          </button>
        ) : null}
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
          <Icon name="sliders" />
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={Boolean(blocker) || submitting || uploading}
          title={blocker}
        >
          <Icon name="upscale" size={18} /> {submitLabel}
        </button>
      </form>
      <p className="prompt-hint muted" id={hintId}>
        {summary}
      </p>
    </div>
  );
}
