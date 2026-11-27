import { useEffect, useRef, useState } from "react";

/**
 * The width an element is laid out at, in CSS pixels, for a chart drawn one viewBox unit to a pixel so its labels keep
 * their size on a phone instead of shrinking with the picture. `fallback` until measured (on the server, and without
 * ResizeObserver).
 */
export function useMeasuredWidth<T extends Element = HTMLDivElement>(fallback = 720) {
  const [width, setWidth] = useState(fallback);
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { const w = Math.round(entry.contentRect.width); if (w > 0) setWidth(w); });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
