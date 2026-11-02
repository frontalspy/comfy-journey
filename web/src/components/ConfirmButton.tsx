import { type ReactNode, useEffect, useState } from "react";

interface ConfirmButtonProps {
  onConfirm: () => void;
  className?: string;
  /** Accessible name of the idle button. */
  label: string;
  children: ReactNode;
}

const ARMED_MS = 3000;

/** Two-step destructive action without a native confirm(): the first press arms it. */
export function ConfirmButton({ onConfirm, className, label, children }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={className}
      aria-label={armed ? `Confirm: ${label}` : label}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? "Sure?" : children}
    </button>
  );
}
