import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { overlayPanelStyle, type OverlayBlockKey, type OverlayPosition, type OverlayStyles } from "@/lib/liveOverlay";

interface OverlayPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "style"> {
  blockKey: OverlayBlockKey;
  styles: OverlayStyles;
  expired?: boolean;
  align?: OverlayPosition["align"];
  children: ReactNode;
  style?: CSSProperties;
}

/** O mesmo painel é usado no OBS, na prévia e no editor de posições. */
export function OverlayPanel({ blockKey, styles, expired = false, align = "left", children, className = "", style, ...props }: OverlayPanelProps) {
  return (
    <div
      {...props}
      className={`overlay-panel ${expired ? "overlay-alert-expired" : ""} ${className}`}
      style={{ ...overlayPanelStyle(styles, blockKey, expired, align), ...style }}
    >
      {children}
    </div>
  );
}
