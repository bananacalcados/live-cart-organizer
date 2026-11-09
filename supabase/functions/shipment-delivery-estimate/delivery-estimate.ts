export const STANDARD_PREPARATION_BUSINESS_DAYS = 3;

export type DeliveryDayRange = { min: number; max: number };
export type DeliveryEstimate = {
  version: 1;
  kind: 'estimated';
  base_date: string;
  start: string;
  end: string;
  delivery_days_min: number;
  delivery_days_max: number;
  preparation_business_days: number;
  calendar: 'mon_fri';
  quoted_at: string;
};

export function saoPauloDate(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Data-base inválida');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Soma dias úteis de segunda a sexta, sem transformar prazo ausente em zero. */
export function addLogisticsBusinessDays(dateOnly: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly) || !Number.isInteger(days) || days < 0 || days > 120) {
    throw new Error('Data ou prazo inválido');
  }
  const date = new Date(`${dateOnly}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('Data-base inválida');
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}

/** Aceita os formatos estruturados já usados pela Expedição: "7" ou "5-9"/"5 a 9". */
export function parseDeliveryDayRange(value: unknown): DeliveryDayRange | null {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,3})(?:\s*(?:-|a|ate|até)\s*(\d{1,3}))?(?:\s*dias?(?:\s*úteis)?)?$/i);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] == null ? min : Number(match[2]);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 60) return null;
  return { min, max };
}

export function isExplicitSedex(sale: { is_sedex?: boolean | null; shipping_type?: string | null }): boolean {
  return sale.is_sedex === true || String(sale.shipping_type || '').trim().toLowerCase() === 'sedex';
}

export type PublicDeliveryEstimate = {
  kind: 'estimated' | 'confirmed';
  start: string;
  end: string;
};

/** A previsão deixa de existir para o cliente assim que há entrega confirmada. */
export function publicDeliveryEstimate(raw: unknown, deliveredAt: unknown): PublicDeliveryEstimate | null {
  if (deliveredAt || !raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const validDate = (date: unknown) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
  if ((value.kind !== 'estimated' && value.kind !== 'confirmed') ||
    !validDate(value.start) || !validDate(value.end)) return null;
  return { kind: value.kind, start: value.start as string, end: value.end as string };
}

export function buildDeliveryEstimate(params: {
  base: string | Date;
  deliveryDays: number | string;
  sedex: boolean;
  quotedAt: string;
}): DeliveryEstimate | null {
  const range = typeof params.deliveryDays === 'number'
    ? (Number.isInteger(params.deliveryDays) && params.deliveryDays >= 0 && params.deliveryDays <= 60
      ? { min: params.deliveryDays, max: params.deliveryDays } : null)
    : parseDeliveryDayRange(params.deliveryDays);
  if (!range) return null;
  const baseDate = saoPauloDate(params.base);
  const preparation = params.sedex ? 0 : STANDARD_PREPARATION_BUSINESS_DAYS;
  return {
    version: 1,
    kind: 'estimated',
    base_date: baseDate,
    start: addLogisticsBusinessDays(baseDate, range.min),
    end: addLogisticsBusinessDays(baseDate, range.max + preparation),
    delivery_days_min: range.min,
    delivery_days_max: range.max,
    preparation_business_days: preparation,
    calendar: 'mon_fri',
    quoted_at: params.quotedAt,
  };
}
