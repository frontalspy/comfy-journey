import type { PublicParam } from "@comfy/shared";
import { useId } from "react";
import { Icon } from "../../../../components/Icon";

type ModifiersDefinition = Extract<PublicParam, { type: "modifiers" }>;
interface Chosen {
  id: string;
  strength: number;
}

interface ModifiersParamProps {
  param: ModifiersDefinition;
  value: unknown;
  onChange: (value: Chosen[]) => void;
}

function chosenOf(value: unknown): Chosen[] {
  return Array.isArray(value) ? (value as Chosen[]) : [];
}

/** Optional add-ons from a fixed menu, each with its own strength. */
export function ModifiersParam({ param, value, onChange }: ModifiersParamProps) {
  const id = useId();
  const chosen = chosenOf(value);
  const available = param.choices.filter((choice) => !chosen.some((c) => c.id === choice.value));
  const labelOf = (choiceId: string) => param.choices.find((c) => c.value === choiceId);

  return (
    <div className="field">
      <span className="field-label" id={`${id}-label`}>
        {param.label}
      </span>
      <ul className="stack" aria-labelledby={`${id}-label`}>
        {chosen.map((entry) => {
          const choice = labelOf(entry.id);
          return (
            <li key={entry.id} className="field">
              <div className="field-label">
                <label htmlFor={`${id}-${entry.id}`}>{choice?.label ?? entry.id}</label>
                <span className="muted">{entry.strength.toFixed(2)}</span>
              </div>
              <div className="row">
                <input
                  id={`${id}-${entry.id}`}
                  type="range"
                  min={param.strength.min}
                  max={param.strength.max}
                  step={param.strength.step}
                  value={entry.strength}
                  onChange={(event) =>
                    onChange(
                      chosen.map((c) =>
                        c.id === entry.id ? { ...c, strength: Number(event.target.value) } : c,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${choice?.label ?? entry.id}`}
                  onClick={() => onChange(chosen.filter((c) => c.id !== entry.id))}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
              {choice?.triggerWords?.length ? (
                <p className="field-hint">Works best with: {choice.triggerWords.join(", ")}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {chosen.length < param.maxCount && available.length > 0 ? (
        <fieldset className="chips" aria-label={`Add ${param.label}`}>
          {available.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className="chip"
              onClick={() =>
                onChange([...chosen, { id: choice.value, strength: param.strength.default }])
              }
            >
              <Icon name="plus" size={14} /> {choice.label}
            </button>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
