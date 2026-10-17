export interface OverlayItem { id: string; text: string; enabled: boolean }
export type OverlayBlockKey = "ticker" | "raffle_bar" | "alert" | "cta" | "wheel";
export interface OverlayPosition { x: number; y: number; width: number; font_size: number; align: "left" | "center" | "right" }
export type OverlayLayout = Record<OverlayBlockKey, OverlayPosition>;
/** Fontes dobradas em 17/10/2026: o texto ficava ilegível no vídeo da live. */
export const DEFAULT_OVERLAY_LAYOUT: OverlayLayout = {
  ticker: { x: 40, y: 200, width: 1000, font_size: 80, align: "center" },
  raffle_bar: { x: 40, y: 330, width: 1000, font_size: 72, align: "center" },
  alert: { x: 60, y: 820, width: 960, font_size: 84, align: "left" },
  cta: { x: 40, y: 1389, width: 1000, font_size: 84, align: "center" },
  wheel: { x: 140, y: 560, width: 800, font_size: 112, align: "center" },
};
export function normalizeOverlayPosition(raw: OverlayPosition): OverlayPosition {
  const width = Math.min(1080, Math.max(160, Number(raw.width) || 160));
  return { ...raw, width, x: Math.min(1080 - width, Math.max(0, Number(raw.x) || 0)), y: Math.min(1919, Math.max(0, Number(raw.y) || 0)), font_size: Math.min(160, Math.max(16, Number(raw.font_size) || 40)), align: ["left", "center", "right"].includes(raw.align) ? raw.align : "center" };
}
export interface OverlayConfig {
  layout: OverlayLayout;
  ticker: { enabled: boolean; interval_seconds: number; items: OverlayItem[] };
  raffle_bar: { enabled: boolean; text_template: string; goal_enabled: boolean; goal_count: number; goal_text: string };
  paid_alert: { enabled: boolean; template: string; duration_seconds: number };
  assembled_alert: { enabled: boolean; template: string; duration_seconds: number };
  cta: { enabled: boolean; interval_minutes: number; items: OverlayItem[] };
  wheel: { enabled: boolean; title_template: string; result_seconds: number };
}

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  layout: DEFAULT_OVERLAY_LAYOUT,
  ticker: { enabled: true, interval_seconds: 6, items: [] },
  raffle_bar: {
    enabled: true,
    text_template: "🎁 {count} clientes já concorrem ao sorteio!",
    goal_enabled: false,
    goal_count: 50,
    goal_text: "Faltam {remaining} para liberar o sorteio!",
  },
  paid_alert: { enabled: true, template: "🎉 @{handle} garantiu {product}!", duration_seconds: 6 },
  assembled_alert: {
    enabled: true,
    template: "✅ @{handle}, seu pedido está pronto! Clique no botão para informar os dados de envio.",
    duration_seconds: 8,
  },
  cta: { enabled: true, interval_minutes: 10, items: [] },
  wheel: { enabled: true, title_template: "🎰 Roleta de @{handle}", result_seconds: 8 },
};

/** Junta o config salvo com os padrões, para nunca faltar campo. */
export function withOverlayDefaults(raw: any): OverlayConfig {
  const c = raw || {};
  const d = DEFAULT_OVERLAY_CONFIG;
  return {
    layout: Object.fromEntries((Object.keys(DEFAULT_OVERLAY_LAYOUT) as OverlayBlockKey[]).map((key) => [key, normalizeOverlayPosition({ ...DEFAULT_OVERLAY_LAYOUT[key], ...(c.layout?.[key] || {}) })])) as OverlayLayout,
    ticker: { ...d.ticker, ...(c.ticker || {}), items: c.ticker?.items || [] },
    raffle_bar: { ...d.raffle_bar, ...(c.raffle_bar || {}) },
    paid_alert: { ...d.paid_alert, ...(c.paid_alert || {}) },
    assembled_alert: { ...d.assembled_alert, ...(c.assembled_alert || {}) },
    cta: { ...d.cta, ...(c.cta || {}), items: c.cta?.items || [] },
    wheel: { ...d.wheel, ...(c.wheel || {}) },
  };
}

export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
