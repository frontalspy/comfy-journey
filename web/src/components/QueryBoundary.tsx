import type { ReactNode } from "react";

interface QueryBoundaryProps {
  isPending: boolean;
  error: Error | null;
  onRetry?: () => void;
  children: ReactNode;
}

/** The one loading and failure treatment for async screens. */
export function QueryBoundary({ isPending, error, onRetry, children }: QueryBoundaryProps) {
  if (isPending) {
    return (
      <div className="empty" role="status">
        <div className="spinner" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="empty" role="alert">
        <h2>Something went wrong</h2>
        <p>{error.message}</p>
        {onRetry ? (
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}
