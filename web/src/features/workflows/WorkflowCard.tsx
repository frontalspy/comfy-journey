import type { PublicWorkflow } from "@comfy/shared";
import { comfyApi } from "../../api/comfyApi";

const KIND_LABEL: Record<PublicWorkflow["kind"], string> = {
  txt2img: "Text to image",
  img2img: "Image to image",
  upscale: "Upscale",
  i2v: "Image to video",
  t2v: "Text to video",
};

interface WorkflowCardProps {
  workflow: PublicWorkflow;
  selected: boolean;
  onUse: () => void;
}

export function WorkflowCard({ workflow, selected, onUse }: WorkflowCardProps) {
  return (
    <li className="card">
      {workflow.preview ? (
        <img
          className="card-preview"
          src={comfyApi.workflowPreviewUrl(workflow.id)}
          alt=""
          loading="lazy"
          decoding="async"
          width={480}
          height={300}
        />
      ) : null}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 17 }}>{workflow.name}</h2>
        <span className="badge">{KIND_LABEL[workflow.kind]}</span>
      </div>
      {workflow.description ? <p className="muted">{workflow.description}</p> : null}
      {workflow.available ? (
        <p className="badge badge-ok" style={{ alignSelf: "flex-start" }}>
          Ready
        </p>
      ) : (
        <p role="status" className="badge badge-bad" style={{ alignSelf: "flex-start" }}>
          Needs attention: {workflow.unavailableReason ?? "unavailable"}
        </p>
      )}
      <button
        type="button"
        className={selected ? "btn" : "btn btn-primary"}
        disabled={!workflow.available}
        onClick={onUse}
      >
        {selected ? "Selected · Open Create" : "Use this workflow"}
      </button>
    </li>
  );
}
