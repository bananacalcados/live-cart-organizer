import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { overlayPanelStyle, type OverlayBlockKey, type OverlayStyles } from "@/lib/liveOverlay";

interface OverlayPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "style"> {
  blockKey: OverlayBlockKey;
  styles: OverlayStyles;
  expired?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}

/** O mesmo painel é usado no OBS, na prévia e no editor de posições. */
export function OverlayPanel({ blockKey, styles, expired = false, children, className = "", style, ...props }: OverlayPanelProps) {
  return (
    <div
      {...props}
      className={`overlay-panel ${expired ? "overlay-alert-expired" : ""} ${className}`}
      style={{ ...overlayPanelStyle(styles, blockKey, expired), ...style }}
    >
      {children}
    </div>
  );
}
