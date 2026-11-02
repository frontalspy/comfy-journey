import { type RefObject, useEffect, useRef, useState } from "react";

/** True once the element has come within `margin` of the viewport (and stays true). */
export function useInView<T extends Element>(
  margin = "400px",
): {
  ref: RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setInView(true);
        observer.disconnect();
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [margin]);
  return { ref, inView };
}
