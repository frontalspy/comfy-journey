import { useCallback, useState } from "react";
import { readStored, writeStored } from "../../../storage";

const KEY = "comfy.dismissedJobs";
const MAX = 100;

const validate = (raw: unknown): string[] | undefined =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : undefined;

/** Failed rows the person has cleared from the feed. */
export function useDismissedJobs(): {
  dismissed: ReadonlySet<string>;
  dismiss: (jobId: string) => void;
} {
  const [ids, setIds] = useState<string[]>(() => readStored(KEY, validate) ?? []);
  const dismiss = useCallback((jobId: string) => {
    setIds((current) => {
      const next = [...current.filter((id) => id !== jobId), jobId].slice(-MAX);
      writeStored(KEY, next);
      return next;
    });
  }, []);
  return { dismissed: new Set(ids), dismiss };
}
