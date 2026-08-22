import type { CSSProperties } from "react";

export const HEADER_FONTS = [
  { value: "", label: "Padrão", css: "" },
  { value: "unbounded", label: "Unbounded", css: "'Unbounded', system-ui, sans-serif" },
  { value: "jakarta", label: "Plus Jakarta", css: "'Plus Jakarta Sans', system-ui, sans-serif" },
  { value: "poppins", label: "Poppins", css: "'Poppins', system-ui, sans-serif" },
  { value: "montserrat", label: "Montserrat", css: "'Montserrat', system-ui, sans-serif" },
  { value: "bebas", label: "Bebas Neue", css: "'Bebas Neue', system-ui, sans-serif" },
  { value: "playfair", label: "Playfair Display", css: "'Playfair Display', Georgia, serif" },
  { value: "mono", label: "Mono", css: "ui-monospace, SFMono-Regular, Menlo, monospace" },
];

export const HEADER_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Poppins:wght@400;600;700;800&family=Montserrat:wght@400;600;700;800&family=Bebas+Neue&family=Playfair+Display:wght@400;600;700;800&display=swap";

export interface HeaderStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  uppercase?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
}

export function headerCss(cfg: any): CSSProperties {
  const s: HeaderStyle = cfg || {};
  const font = HEADER_FONTS.find((f) => f.value === s.fontFamily);
  return {
    fontFamily: font?.css || undefined,
    fontSize: s.fontSize ? `${s.fontSize}px` : undefined,
    fontWeight: s.bold === false ? 500 : 700,
    fontStyle: s.italic ? "italic" : undefined,
    textDecoration: s.underline ? "underline" : undefined,
    textTransform: s.uppercase === false ? "none" : "uppercase",
    color: s.color || undefined,
    textAlign: s.align || "center",
  };
}
