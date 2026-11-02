import type { PublicParam } from "@comfy/shared";
import { useId } from "react";
import { Icon } from "../../../../components/Icon";
import { ImagesParam } from "./ImagesParam";
import { ModifiersParam } from "./ModifiersParam";

interface ParamFieldProps {
  param: PublicParam;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function ParamField({ param, value, onChange }: ParamFieldProps) {
  const id = useId();
  const hint = param.description ? (
    <p className="field-hint" id={`${id}-hint`}>
      {param.description}
    </p>
  ) : null;
  const describedBy = param.description ? `${id}-hint` : undefined;

  switch (param.type) {
    case "int":
    case "float": {
      const step = param.step ?? (param.type === "int" ? 1 : 0.1);
      const numeric = typeof value === "number" ? value : param.default;
      return (
        <div className="field">
          <div className="field-label">
            <label htmlFor={id}>{param.label}</label>
            <span className="muted">{numeric}</span>
          </div>
          <input
            id={id}
            type="range"
            min={param.min}
            max={param.max}
            step={step}
            value={numeric}
            aria-describedby={describedBy}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          {hint}
        </div>
      );
    }
    case "enum":
      return (
        <fieldset className="field" aria-labelledby={`${id}-label`}>
          <span className="field-label" id={`${id}-label`}>
            {param.label}
          </span>
          <div className="chips">
            {param.choices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className="chip"
                aria-pressed={value === choice.value}
                onClick={() => onChange(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          {hint}
        </fieldset>
      );
    case "seed": {
      const random = value === -1 || typeof value !== "number";
      return (
        <div className="field">
          <label className="field-label" htmlFor={id}>
            {param.label}
          </label>
          <div className="row">
            <input
              id={id}
              className="input"
              type="number"
              inputMode="numeric"
              min={-1}
              placeholder="Random"
              value={random ? "" : String(value)}
              aria-describedby={describedBy}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                onChange(Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1);
              }}
            />
            <button
              type="button"
              className="btn"
              aria-pressed={random}
              onClick={() => onChange(-1)}
            >
              <Icon name="dice" size={18} /> Random
            </button>
          </div>
          {hint}
        </div>
      );
    }
    case "boolean":
      return (
        <div className="field">
          <label className="switch" htmlFor={id}>
            <span className="field-label">{param.label}</span>
            <input
              id={id}
              type="checkbox"
              role="switch"
              checked={value === true}
              aria-checked={value === true}
              aria-describedby={describedBy}
              onChange={(event) => onChange(event.target.checked)}
            />
          </label>
          {hint}
        </div>
      );
    case "text":
      return (
        <div className="field">
          <label className="field-label" htmlFor={id}>
            {param.label}
          </label>
          {param.multiline ? (
            <textarea
              id={id}
              className="input"
              rows={3}
              maxLength={param.maxLength}
              value={typeof value === "string" ? value : ""}
              aria-describedby={describedBy}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : (
            <input
              id={id}
              className="input"
              type="text"
              maxLength={param.maxLength}
              value={typeof value === "string" ? value : ""}
              aria-describedby={describedBy}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
          {hint}
        </div>
      );
    case "image":
    case "images":
      return (
        <ImagesParam
          param={param}
          value={value}
          maxCount={param.type === "image" ? 1 : param.maxCount}
          single={param.type === "image"}
          onChange={onChange}
        />
      );
    case "modifiers":
      return <ModifiersParam param={param} value={value} onChange={onChange} />;
  }
}
