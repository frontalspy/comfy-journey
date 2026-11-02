import { type FormEvent, type KeyboardEvent, useId } from "react";
import { Icon } from "../../../components/Icon";

interface PromptBarProps {
  prompt: string;
  placeholder: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  onOpenSettings: () => void;
  /** Why creating is not possible right now, shown as the button's tooltip. */
  blocker: string | undefined;
  submitting: boolean;
  /** One line under the bar, e.g. "Krea 2 Turbo · 1024 × 1024". */
  summary: string;
}

export function PromptBar({
  prompt,
  placeholder,
  onPromptChange,
  onSubmit,
  onOpenSettings,
  blocker,
  submitting,
  summary,
}: PromptBarProps) {
  const hintId = useId();

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!blocker && !submitting) onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!blocker && !submitting) onSubmit();
  }

  return (
    <div className="prompt-bar-wrap">
      <form className="prompt-bar" onSubmit={handleSubmit} aria-label="Create">
        <label className="sr-only" htmlFor="prompt-input">
          Prompt
        </label>
        <textarea
          id="prompt-input"
          rows={1}
          value={prompt}
          placeholder={placeholder}
          aria-describedby={hintId}
          enterKeyHint="send"
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
          <Icon name="sliders" />
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={Boolean(blocker) || submitting}
          title={blocker}
        >
          <Icon name="create" size={18} /> Create
        </button>
      </form>
      <p className="prompt-hint muted" id={hintId}>
        {summary}
      </p>
    </div>
  );
}
