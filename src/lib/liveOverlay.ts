export interface OverlayItem { id: string; text: string; enabled: boolean }
export interface OverlayConfig {
  ticker: { enabled: boolean; interval_seconds: number; items: OverlayItem[] };
  raffle_bar: { enabled: boolean; text_template: string; goal_enabled: boolean; goal_count: number; goal_text: string };
  paid_alert: { enabled: boolean; template: string; duration_seconds: number };
  assembled_alert: { enabled: boolean; template: string; duration_seconds: number };
  cta: { enabled: boolean; interval_minutes: number; items: OverlayItem[] };
}

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
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
};

/** Junta o config salvo com os padrões, para nunca faltar campo. */
export function withOverlayDefaults(raw: any): OverlayConfig {
  const c = raw || {};
  const d = DEFAULT_OVERLAY_CONFIG;
  return {
    ticker: { ...d.ticker, ...(c.ticker || {}), items: c.ticker?.items || [] },
    raffle_bar: { ...d.raffle_bar, ...(c.raffle_bar || {}) },
    paid_alert: { ...d.paid_alert, ...(c.paid_alert || {}) },
    assembled_alert: { ...d.assembled_alert, ...(c.assembled_alert || {}) },
    cta: { ...d.cta, ...(c.cta || {}), items: c.cta?.items || [] },
  };
}

export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
