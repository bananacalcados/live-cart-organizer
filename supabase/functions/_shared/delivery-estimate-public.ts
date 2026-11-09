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
