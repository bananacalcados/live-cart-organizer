import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { normalizeOverlayPosition, OverlayPosition } from "@/lib/liveOverlay";

/** Shared bounds for both the OBS view and the position editor. */
export function OverlayBlock({ position, children, blockKey, className = "" }: { position: OverlayPosition; children: ReactNode; blockKey: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight((previous) => previous === el.offsetHeight ? previous : el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const p = normalizeOverlayPosition(position);
  return <div ref={ref} data-overlay-block={blockKey} className={`absolute overflow-hidden ${className}`} style={{ left: p.x, top: Math.max(0, Math.min(p.y, 1920 - height)), width: p.width, maxHeight: 1920, fontSize: p.font_size, textAlign: p.align, whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere" }}>{children}</div>;
}