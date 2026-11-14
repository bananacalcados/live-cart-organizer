export interface OverlayItem { id: string; text: string; enabled: boolean }
/** A fixed link starts a fresh cursor when the live changes, never replaying the previous live. */
export function overlayEventChanged(previous: string | null, incoming: string | null): boolean {
  return previous !== null && incoming !== null && previous !== incoming;
}
export type OverlayBlockKey = "ticker" | "raffle_bar" | "alert" | "cta" | "wheel" | "timers" | "shown_product";
export type OverlayFontWeight = 400 | 600 | 700 | 800 | 900;
export interface OverlayBlockStyle {
  bg_color: string;
  bg_opacity: number;
  text_color: string;
  font_weight: OverlayFontWeight;
  border_color?: string;
}
export type OverlayStyles = Record<OverlayBlockKey, OverlayBlockStyle>;
export interface OverlayPosition { x: number; y: number; width: number; font_size: number; align: "left" | "center" | "right" }
export type OverlayLayout = Record<OverlayBlockKey, OverlayPosition>;
/**
 * Fontes quase dobradas em 17/10/2026: o texto ficava ilegível no vídeo da live.
 * Posições pensadas para a faixa útil do Instagram (180–1500): faixa no topo,
 * barra/chamada no meio, aviso de compra embaixo — sem um bloco cobrir o outro.
 */
export const DEFAULT_OVERLAY_LAYOUT: OverlayLayout = {
  ticker: { x: 20, y: 190, width: 1040, font_size: 76, align: "center" },
  raffle_bar: { x: 20, y: 620, width: 1040, font_size: 72, align: "center" },
  alert: { x: 20, y: 1010, width: 1040, font_size: 72, align: "left" },
  cta: { x: 20, y: 620, width: 1040, font_size: 84, align: "center" },
  wheel: { x: 20, y: 620, width: 1040, font_size: 108, align: "center" },
  timers: { x: 20, y: 1250, width: 1040, font_size: 44, align: "left" },
  // Produto em exibição: coluna à direita, entre a faixa e a barra do sorteio.
  shown_product: { x: 720, y: 360, width: 340, font_size: 48, align: "right" },
};
export function normalizeOverlayPosition(raw: OverlayPosition): OverlayPosition {
  const width = Math.min(1080, Math.max(160, Number(raw.width) || 160));
  return { ...raw, width, x: Math.min(1080 - width, Math.max(0, Number(raw.x) || 0)), y: Math.min(1919, Math.max(0, Number(raw.y) || 0)), font_size: Math.min(160, Math.max(16, Number(raw.font_size) || 40)), align: ["left", "center", "right"].includes(raw.align) ? raw.align : "center" };
}
export const DEFAULT_OVERLAY_STYLES: OverlayStyles = {
  ticker: { bg_color: "#000000", bg_opacity: 0.6, text_color: "#ffffff", font_weight: 700 },
  raffle_bar: { bg_color: "#000000", bg_opacity: 0.6, text_color: "#ffffff", font_weight: 700 },
  alert: { bg_color: "#000000", bg_opacity: 0.6, text_color: "#ffffff", font_weight: 800 },
  cta: { bg_color: "#000000", bg_opacity: 0.6, text_color: "#ffffff", font_weight: 800 },
  wheel: { bg_color: "#000000", bg_opacity: 0.6, text_color: "#ffffff", font_weight: 800 },
  timers: { bg_color: "#000000", bg_opacity: 0.6, text_color: "#ffffff", font_weight: 700 },
  shown_product: { bg_color: "#000000", bg_opacity: 0.6, text_color: "#ffffff", font_weight: 400 },
};

export interface OverlayConfig {
  layout: OverlayLayout;
  styles: OverlayStyles;
  reload_nonce?: number;
  ticker: { enabled: boolean; interval_seconds: number; items: OverlayItem[] };
  raffle_bar: { enabled: boolean; text_template: string; goal_enabled: boolean; goal_count: number; goal_text: string };
  paid_alert: { enabled: boolean; template: string; duration_seconds: number };
  assembled_alert: { enabled: boolean; template: string; duration_seconds: number };
  cta: { enabled: boolean; interval_minutes: number; items: OverlayItem[] };
  wheel: { enabled: boolean; title_template: string; result_seconds: number; test_handles?: string };
  /** Relógios de pagamento: fila, um pedido por vez, cada um por duration_seconds. */
  payment_timers: { enabled: boolean; template: string; duration_seconds: number };
  /** Aviso de par liberado quando o prazo de pagamento vence. */
  expired_alert: { enabled: boolean; template: string; template_no_stock: string; duration_seconds: number };
  /** Código do produto em exibição (dados vêm de overlay_shown_products). */
  shown_product: { enabled: boolean };
}

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  layout: DEFAULT_OVERLAY_LAYOUT,
  styles: DEFAULT_OVERLAY_STYLES,
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
  payment_timers: { enabled: true, template: "✅ @{handle}, seu carrinho está pronto! ⏳ {timer} para pagar e concorrer à bolsa 🎁", duration_seconds: 6 },
  expired_alert: { enabled: true, template: "🔁 Liberou o {size} do {product}! Quem quer?", template_no_stock: "⌛ @{handle}, o prazo da bolsa acabou!", duration_seconds: 8 },
  shown_product: { enabled: true },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FONT_WEIGHTS: OverlayFontWeight[] = [400, 600, 700, 800, 900];
const normalizeHex = (value: unknown, fallback: string) => typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;

export function normalizeOverlayStyle(raw: any, key: OverlayBlockKey): OverlayBlockStyle {
  const fallback = DEFAULT_OVERLAY_STYLES[key];
  const numericOpacity = Number(raw?.bg_opacity);
  const numericWeight = Number(raw?.font_weight) as OverlayFontWeight;
  const border = raw?.border_color == null ? undefined : normalizeHex(raw.border_color, "");
  return {
    bg_color: normalizeHex(raw?.bg_color, fallback.bg_color),
    bg_opacity: raw?.bg_opacity == null || !Number.isFinite(numericOpacity) ? fallback.bg_opacity : Math.min(1, Math.max(0, numericOpacity)),
    text_color: normalizeHex(raw?.text_color, fallback.text_color),
    font_weight: FONT_WEIGHTS.includes(numericWeight) ? numericWeight : fallback.font_weight,
    ...(border ? { border_color: border } : {}),
  };
}

export function overlayPanelStyle(styles: OverlayStyles, key: OverlayBlockKey, expired = false) {
  const style = normalizeOverlayStyle(styles?.[key], key);
  const hex = style.bg_color.slice(1);
  const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ");
  return {
    background: expired ? "hsl(var(--overlay-expired) / 0.85)" : `rgba(${rgb}, ${style.bg_opacity})`,
    color: style.text_color,
    fontWeight: style.font_weight,
    ...(style.border_color ? { borderColor: style.border_color } : {}),
  };
}

export function normalizeReloadNonce(value: unknown): number | null {
  const nonce = Number(value);
  return Number.isFinite(nonce) && nonce > 0 ? nonce : null;
}

/** O primeiro valor só inicializa; uma mudança posterior pede recarga. */
export function shouldReloadOverlayForNonce(previous: number | null, incoming: unknown, initialized: boolean): boolean {
  return initialized && previous !== normalizeReloadNonce(incoming);
}

/** Junta o config salvo com os padrões, para nunca faltar campo. */
export function withOverlayDefaults(raw: any): OverlayConfig {
  const c = raw || {};
  const d = DEFAULT_OVERLAY_CONFIG;
  return {
    layout: Object.fromEntries((Object.keys(DEFAULT_OVERLAY_LAYOUT) as OverlayBlockKey[]).map((key) => [key, normalizeOverlayPosition({ ...DEFAULT_OVERLAY_LAYOUT[key], ...(c.layout?.[key] || {}) })])) as OverlayLayout,
    styles: Object.fromEntries((Object.keys(DEFAULT_OVERLAY_STYLES) as OverlayBlockKey[]).map((key) => [key, normalizeOverlayStyle(c.styles?.[key], key)])) as OverlayStyles,
    reload_nonce: normalizeReloadNonce(c.reload_nonce) ?? undefined,
    ticker: { ...d.ticker, ...(c.ticker || {}), items: c.ticker?.items || [] },
    raffle_bar: { ...d.raffle_bar, ...(c.raffle_bar || {}) },
    paid_alert: { ...d.paid_alert, ...(c.paid_alert || {}) },
    assembled_alert: { ...d.assembled_alert, ...(c.assembled_alert || {}) },
    cta: { ...d.cta, ...(c.cta || {}), items: c.cta?.items || [] },
    wheel: { ...d.wheel, ...(c.wheel || {}) },
    payment_timers: { ...d.payment_timers, ...(c.payment_timers || {}) },
    expired_alert: { ...d.expired_alert, ...(c.expired_alert || {}) },
    shown_product: { ...d.shown_product, ...(c.shown_product || {}) },
  };
}

export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));

/** A escolha manual aparece mesmo quando os códigos automáticos estão desligados. */
export function shouldShowCurrentShownProduct(
  showCodes: boolean,
  current: { source?: string | null } | null,
): boolean {
  return !!current && (showCodes || current.source === "manual");
}

/** Tempo restante em mm:ss (nunca negativo). */
export const formatTimer = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export interface PaymentTimer { orderId: string; handle: string; product: string; size: string; expiresAt: number; addedAt: number }
/** Ainda vale mostrar: prazo não venceu e entrou há menos de 20 min. */
export const timerStillValid = (t: PaymentTimer, now: number) => t.expiresAt > now && now - t.addedAt < 20 * 60_000;
/**
 * Fila dos relógios: um por vez, na ordem de chegada. Devolve o próximo válido e
 * a fila restante (descartando vencidos), para nunca empilhar vários na tela.
 */
export function takeNextTimer(queue: PaymentTimer[], now: number): { next: PaymentTimer | null; rest: PaymentTimer[] } {
  const valid = queue.filter((t) => timerStillValid(t, now));
  return { next: valid[0] || null, rest: valid.slice(1) };
}
/** Tempo em tela de cada relógio (mínimo 2 s). */
export const timerShowSeconds = (cfg: OverlayConfig["payment_timers"]) => Math.max(2, Number(cfg.duration_seconds) || 6);

/** Aviso de vencimento: sem estoque além do carrinho, usa o texto "prazo acabou". */
export function expiredAlertTemplate(cfg: OverlayConfig["expired_alert"], payload: { has_stock?: boolean }): string {
  return payload?.has_stock === false ? (cfg.template_no_stock || DEFAULT_OVERLAY_CONFIG.expired_alert.template_no_stock) : cfg.template;
}
