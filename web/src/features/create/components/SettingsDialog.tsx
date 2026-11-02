import type { PublicWorkflow } from "@comfy/shared";
import { Icon } from "../../../components/Icon";
import { ModalDialog } from "../../../components/ModalDialog";
import { activeAspect, aspectOptions, type FormValues, splitParams } from "../formValues";
import { ParamField } from "./params/ParamField";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  workflows: PublicWorkflow[];
  workflow: PublicWorkflow;
  values: FormValues;
  onSelectWorkflow: (workflowId: string) => void;
  onChange: (paramId: string, value: unknown) => void;
}

/** Workflow, size, count and every other setting: a popover on desktop, a bottom sheet on a phone. */
export function SettingsDialog({
  open,
  onClose,
  workflows,
  workflow,
  values,
  onSelectWorkflow,
  onChange,
}: SettingsDialogProps) {
  const split = splitParams(workflow);
  const aspects = split.width && split.height ? aspectOptions(split.width, split.height) : [];
  const width = Number(values.width);
  const height = Number(values.height);
  const active = activeAspect(aspects, width, height);
  const basic = split.rest.filter((param) => !param.advanced);
  const advanced = split.rest.filter((param) => param.advanced);

  return (
    <ModalDialog open={open} onClose={onClose} label="Settings" className="sheet">
      <div className="sheet-head">
        <h2>Settings</h2>
        <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="sheet-body">
        {workflows.length > 1 ? (
          <fieldset className="field" aria-labelledby="settings-workflow">
            <span className="field-label" id="settings-workflow">
              Workflow
            </span>
            <div className="chips">
              {workflows.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="chip"
                  aria-pressed={candidate.id === workflow.id}
                  disabled={!candidate.available}
                  title={candidate.unavailableReason ?? candidate.description}
                  onClick={() => onSelectWorkflow(candidate.id)}
                >
                  {candidate.name}
                </button>
              ))}
            </div>
            {workflow.description ? <p className="field-hint">{workflow.description}</p> : null}
          </fieldset>
        ) : null}

        {split.width && split.height ? (
          <fieldset className="field" aria-labelledby="settings-aspect">
            <div className="field-label">
              <span id="settings-aspect">Aspect ratio</span>
              <span className="muted">
                {width} × {height}
              </span>
            </div>
            <div className="chips">
              {aspects.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="chip"
                  aria-pressed={active?.label === option.label}
                  onClick={() => {
                    onChange(split.width?.id ?? "width", option.width);
                    onChange(split.height?.id ?? "height", option.height);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {split.batch ? (
          <ParamField
            param={split.batch}
            value={values[split.batch.id]}
            onChange={(v) => onChange(split.batch?.id ?? "", v)}
          />
        ) : null}

        {basic.map((param) => (
          <ParamField
            key={param.id}
            param={param}
            value={values[param.id]}
            onChange={(v) => onChange(param.id, v)}
          />
        ))}

        {advanced.length > 0 ? (
          <details>
            <summary
              className="field-label"
              style={{ minHeight: 44, display: "flex", alignItems: "center" }}
            >
              Advanced
            </summary>
            <div className="stack" style={{ marginTop: 12 }}>
              {advanced.map((param) => (
                <ParamField
                  key={param.id}
                  param={param}
                  value={values[param.id]}
                  onChange={(v) => onChange(param.id, v)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </ModalDialog>
  );
}
