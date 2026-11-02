import { type Job, jobEventSchema } from "@comfy/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { applyJobEvent } from "../applyJobEvent";
import { JOBS_KEY } from "./useJobs";

const EVENTS_URL = "/api/events";

/**
 * The app's single live connection. EventSource reconnects by itself; after any reconnect the
 * job list and gallery are refetched so nothing that happened in the gap is missed.
 */
export function useJobEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource(EVENTS_URL);
    let connectedBefore = false;

    source.onopen = () => {
      if (connectedBefore) {
        void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
        void queryClient.invalidateQueries({ queryKey: ["images"] });
      }
      connectedBefore = true;
    };

    source.onmessage = (message: MessageEvent<string>) => {
      let raw: unknown;
      try {
        raw = JSON.parse(message.data);
      } catch {
        return;
      }
      const parsed = jobEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const event = parsed.data;

      const cached = queryClient.getQueryData<Job[]>(JOBS_KEY);
      if (cached) {
        const applied = applyJobEvent(cached, event);
        if (applied.known) queryClient.setQueryData(JOBS_KEY, applied.jobs);
        else void queryClient.invalidateQueries({ queryKey: JOBS_KEY });
      }
      if (event.type === "image" || event.type === "done") {
        void queryClient.invalidateQueries({ queryKey: ["images"] });
      }
    };

    return () => source.close();
  }, [queryClient]);
}
