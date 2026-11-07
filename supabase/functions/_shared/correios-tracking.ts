// Consulta sob demanda do rastreio de etiquetas emitidas pelo contrato próprio.
// Credenciais e código real ficam no servidor; a página pública recebe só eventos traduzidos.
import { getCorreiosToken, createCorreiosFetch } from './correios.ts';
import type { RealEvent } from './frenet-tracking.ts';

const OBJECT_CODE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

/** A API pode omitir o fuso; nesse caso o horário recebido é o de Brasília. */
export function parseCorreiosDate(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw);
  const date = new Date(local ? `${raw}-03:00` : raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function eventLocation(event: any): string {
  const address = event?.unidade?.endereco || event?.endereco || {};
  const city = String(address.cidade || event?.unidade?.nome || event?.cidade || '').trim();
  const state = String(address.uf || event?.uf || '').trim();
  return city && state ? `${city}/${state}` : city;
}

/** Converte somente o objeto pedido e descarta eventos sem data ou descrição válidas. */
export function normalizeCorreiosEvents(payload: any, trackingNumber: string): RealEvent[] {
  const code = trackingNumber.trim().toUpperCase();
  const objects = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.objetos)
      ? payload.objetos
      : payload?.codObjeto
        ? [payload]
        : [];
  const object = objects.find((item: any) => String(item?.codObjeto || '').toUpperCase() === code);
  if (!object || !Array.isArray(object.eventos)) return [];

  return object.eventos.map((event: any) => {
    const at = parseCorreiosDate(event?.dtHrCriado || event?.dataHora || event?.data);
    const description = String(event?.descricao || '').trim();
    if (!at || !description) return null;
    return {
      at,
      description,
      location: eventLocation(event),
      type: String(event?.codigo || event?.tipo || ''),
    } satisfies RealEvent;
  }).filter((event: RealEvent | null): event is RealEvent => !!event)
    .sort((a: RealEvent, b: RealEvent) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Busca o histórico completo no Rastro/SRO, renovando uma credencial vencida uma vez. */
export async function fetchCorreiosEvents(
  db: any,
  trackingNumber: string,
): Promise<{ events: RealEvent[] } | null> {
  const code = trackingNumber.trim().toUpperCase();
  if (!OBJECT_CODE.test(code)) return null;

  const first = await getCorreiosToken(db);
  const call = async (settings: any, token: string) => {
    const data = await createCorreiosFetch(settings, token)(
      `/srorastro/v1/objetos/${encodeURIComponent(code)}?resultado=T&idioma=pt-BR`,
      { method: 'GET' },
    );
    return normalizeCorreiosEvents(data, code);
  };

  try {
    return { events: await call(first.settings, first.token) };
  } catch (error) {
    if (!/credenciais inválidas|401|403/i.test((error as Error).message)) throw error;
    const renewed = await getCorreiosToken(db, { force: true, settings: first.settings });
    return { events: await call(renewed.settings, renewed.token) };
  }
}
