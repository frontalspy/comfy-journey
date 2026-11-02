import { type ReactNode, useEffect, useRef } from "react";

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * A native <dialog>: focus trap, Escape and focus return come from the platform. `open` drives
 * it; the browser closing it (Escape) is reported through `onClose`.
 */
export function ModalDialog({ open, onClose, label, className, children }: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled natively by <dialog>; the click only dismisses on the backdrop.
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
