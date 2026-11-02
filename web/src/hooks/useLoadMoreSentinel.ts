import { type RefObject, useEffect, useRef } from "react";

/**
 * Calls `onNearEnd` whenever the returned sentinel element is within a screen of the viewport.
 * Place the sentinel after the list. `enabled` should be false while a page is loading or when
 * there are no more pages, which re-arms the observer for the next page.
 */
export function useLoadMoreSentinel(
  onNearEnd: () => void,
  enabled: boolean,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onNearEnd);
  callback.current = onNearEnd;

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) callback.current();
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);

  return ref;
}
