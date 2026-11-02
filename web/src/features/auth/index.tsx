import type { ReactNode } from "react";
import { ApiError } from "../../api/client";
import { QueryBoundary } from "../../components/QueryBoundary";
import { useViewer } from "./hooks/useViewer";
import { LoginForm } from "./LoginForm";

/** Renders its children once the server has identified the caller; asks for a token on 401. */
export function AuthGate({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  if (viewer.error instanceof ApiError && viewer.error.status === 401) return <LoginForm />;
  return (
    <QueryBoundary
      isPending={viewer.isPending}
      error={viewer.error}
      onRetry={() => void viewer.refetch()}
    >
      {children}
    </QueryBoundary>
  );
}

export { useViewer } from "./hooks/useViewer";
export { SESSION_FLAG } from "./LoginForm";
