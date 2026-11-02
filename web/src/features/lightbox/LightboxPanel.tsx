import type { AppImage } from "@comfy/shared";
import { comfyApi } from "../../api/comfyApi";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toasts";
import { formatBytes, formatDate } from "../media/format";
import type { ImageActions } from "../media/hooks/useImageActions";
import { useWorkflows } from "../workflows/hooks/useWorkflows";
import { describeSettings, fullPrompt } from "./imageFacts";

interface LightboxPanelProps {
  image: AppImage;
  position: string;
  actions: ImageActions;
}

export function LightboxPanel({ image, position, actions }: LightboxPanelProps) {
  const { notify } = useToast();
  const workflow = useWorkflows().data?.find((candidate) => candidate.id === image.workflowId);
  const prompt = fullPrompt(image);
  const facts = describeSettings(image, workflow);

  async function copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(prompt);
      notify("Prompt copied.");
    } catch {
      notify("Could not copy. Select the text instead.", "error");
    }
  }

  return (
    <aside className="lightbox-panel" aria-label="Details">
      <p className="muted" aria-live="polite">
        {position}
      </p>
      <section className="stack" aria-label="Prompt">
        <p className="prompt-full">{prompt || "No prompt recorded."}</p>
        <div className="panel-actions">
          <button
            type="button"
            className="btn btn-small"
            onClick={() => void copyPrompt()}
            disabled={!prompt}
          >
            <Icon name="copy" size={16} /> Copy
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => actions.reusePrompt(image)}
          >
            <Icon name="text" size={16} /> Use prompt
          </button>
        </div>
      </section>
      <section className="panel-actions" aria-label="Actions">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => actions.reuseSettings(image)}
        >
          <Icon name="sliders" size={16} /> Use settings
        </button>
        <button type="button" className="btn btn-small" onClick={() => actions.variation(image)}>
          <Icon name="refresh" size={16} /> Variation
        </button>
        <button
          type="button"
          className="btn btn-small"
          aria-pressed={image.favourite}
          onClick={() => actions.toggleFavourite(image)}
        >
          <Icon name="heart" size={16} filled={image.favourite} />{" "}
          {image.favourite ? "Favourited" : "Favourite"}
        </button>
        <a className="btn btn-small" href={comfyApi.downloadUrl(image.id)} download>
          <Icon name="download" size={16} /> Download
        </a>
        <ConfirmButton
          className="btn btn-small btn-danger"
          label="Delete"
          onConfirm={() => actions.remove(image)}
        >
          <Icon name="trash" size={16} /> Delete
        </ConfirmButton>
      </section>
      <dl className="facts">
        {facts.map((fact) => (
          <div key={fact.label} style={{ display: "contents" }}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
        <dt>Created</dt>
        <dd>{formatDate(image.createdAt)}</dd>
        <dt>File</dt>
        <dd>
          {image.mime} · {formatBytes(image.bytes)}
        </dd>
      </dl>
    </aside>
  );
}
