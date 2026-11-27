import { sanitize, translateRealEvent, type PublicEvent } from './shipment-stages.ts';

type RealEvent = {
  at?: string;
  EventDateTime?: string;
  description?: string;
  EventDescription?: string;
  location?: string;
  EventLocation?: string;
  type?: string | null;
  status?: string | null;
};

const norm = (s: string) =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const cityOf = (ev: RealEvent) => {
  const loc = sanitize(String(ev.location || ev.EventLocation || ''));
  const [city, state] = loc.split(/[\/-]/).map((s) => s.trim());
  return { city: city || '', state: state || '' };
};

export function shouldShowOriginEvent(
  description: string,
  type: string | null | undefined,
  translatedTitle: string,
  departureAlreadyShown: boolean,
): boolean {
  // NÃO REMOVER: na origem, postagem/coleta/etiqueta e correção FC ficam ocultas.
  // Só a primeira saída real aparece, sem revelar a origem; entrega mantém a tradução atual.
  if (String(type || '').toUpperCase() === 'FC') return false;
  if (translatedTitle !== 'Pedido em trânsito') return true;
  if (/etiqueta|coletad[oa]|coleta|postad[oa]|postagem/i.test(description)) return false;
  return !departureAlreadyShown && /transfer[êe]ncia|encaminhado|sa[ií]da da encomenda/i.test(description);
}

/** Produz apenas as linhas públicas; não altera eventos persistidos nem etapas do pedido. */
export function publicRealTrackingEvents(
  real: readonly RealEvent[],
  origin: string,
  fulfillment: string,
  sentAt: number,
  now: Date,
): PublicEvent[] {
  const originCity = norm(origin || (real.map(cityOf).find((c) => c.city)?.city ?? ''));
  const atOrigin = (ev: RealEvent) => {
    const { city } = cityOf(ev);
    return !city || Boolean(originCity && norm(city) === originCity);
  };
  const descriptionOf = (ev: RealEvent) => String(ev.description || ev.EventDescription || '');
  const whenOf = (ev: RealEvent) => new Date(ev.at || ev.EventDateTime || now).getTime();

  // Seleciona cronologicamente sem reordenar as movimentações fora da origem.
  const firstDeparture = real.reduce<RealEvent | undefined>((first, ev) => {
    if (!atOrigin(ev)) return first;
    const description = descriptionOf(ev);
    const tr = translateRealEvent(description, fulfillment, ev);
    if (tr?.title !== 'Pedido em trânsito' || !shouldShowOriginEvent(description, ev.type, tr.title, false)) return first;
    return !first || whenOf(ev) < whenOf(first) ? ev : first;
  }, undefined);

  const events: PublicEvent[] = [];
  let last = sentAt;
  let departureShown = false;
  for (const ev of real) {
    const when = whenOf(ev);
    const description = descriptionOf(ev);
    const tr = translateRealEvent(description, fulfillment, ev);
    if (!tr) continue;
    const originEvent = atOrigin(ev);
    const departure = originEvent && tr.title === 'Pedido em trânsito';
    if (originEvent && !shouldShowOriginEvent(description, ev.type, tr.title, departureShown || (departure && ev !== firstDeparture))) continue;
    const { city, state } = cityOf(ev);
    // Trava de coerência: nunca voltar no tempo.
    const at = new Date(Math.max(when, last + 60000));
    last = at.getTime();
    if (departure) departureShown = true; // RO/DO no mesmo horário não geram uma segunda linha.
    events.push({
      title: tr.title,
      detail: departure ? 'Seu pedido está a caminho da sua cidade.' : tr.detail,
      ...(departure ? {} : { city: city || undefined, state: state || undefined }),
      at: at.toISOString(),
    });
  }
  return events;
}