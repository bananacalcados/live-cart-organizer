import { isRealDeliveryEvent } from './delivery-event.ts';
// Consulta sob demanda do rastreio real na Frenet.
// Nunca expõe transportadora ou código real ao cliente — uso interno apenas.

export type RealEvent = {
  at: string;
  description: string;
  location: string;
  type?: string;
  /** Código de status do evento (Correios: 01 = entregue; 20 = carteiro não atendido...). */
  status?: string;
};

const FRENET_URL = 'https://api.frenet.com.br/tracking/trackinginfo';

/** Códigos de serviço da conta (SEDEX / PAC). */
export const SERVICE_CODES = {
  sedex: '03220',
  pac: '03298',
  mini: '04227',
  jt: 'JTE_INT',
  jadlog: 'F_3',
  loggi: 'LOG_DRPOFF',
  total: 'TOT_EXPRSS',
} as const;

export function parseFrenetDate(s: string): string {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 3, +m[5], +(m[6] || 0))).toISOString();
  // Formato ISO sem fuso ("2026-09-22 01:27:24") vem no horário de Brasília.
  const iso = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4] + 3, +iso[5], +(iso[6] || 0))).toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Adivinha o código de serviço a partir do nome salvo internamente. */
export function guessServiceCode(carrier?: string | null): string | null {
  const c = String(carrier || '').toLowerCase();
  if (c.includes('sedex')) return SERVICE_CODES.sedex;
  if (c.includes('pac')) return SERVICE_CODES.pac;
  if (c.includes('mini')) return SERVICE_CODES.mini;
  if (c.includes('j&t') || c.includes('jt ') || c.includes('j&t') || /\bjt\b|jte/.test(c)) return SERVICE_CODES.jt;
  if (c.includes('jadlog')) return SERVICE_CODES.jadlog;
  if (c.includes('loggi')) return SERVICE_CODES.loggi;
  if (c.includes('total')) return SERVICE_CODES.total;
  return null;
}

/** Ordem de tentativa pelo formato do código, quando a transportadora é desconhecida. */
function candidatesForCode(code: string): string[] {
  const t = code.trim().toUpperCase();
  const all = Object.values(SERVICE_CODES) as string[];
  let first: string[] = [];
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(t)) first = [SERVICE_CODES.sedex, SERVICE_CODES.pac, SERVICE_CODES.mini];
  else if (/^888\d{9,}$/.test(t)) first = [SERVICE_CODES.jt];
  else if (/^\d{8,14}$/.test(t)) first = [SERVICE_CODES.jadlog, SERVICE_CODES.jt];
  return [...first, ...all.filter((c) => !first.includes(c))];
}

async function callFrenet(token: string, serviceCode: string, trackingNumber: string) {
  const res = await fetch(FRENET_URL, {
    method: 'POST',
    headers: { token, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ShippingServiceCode: serviceCode, TrackingNumber: trackingNumber }),
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json || json.ErrorMessage) return null;
  const events = Array.isArray(json.TrackingEvents) ? json.TrackingEvents : [];
  return events.length ? events : null;
}

export function isJadlogTrackingSource(carrier?: string | null, trackingUrl?: string | null): boolean {
  return String(carrier || '').toLowerCase().includes('jadlog') || /\/JAD\//i.test(String(trackingUrl || ''));
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== '#') return named[key.toLowerCase()] ?? entity;
    const hex = key[1]?.toLowerCase() === 'x';
    const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

function cleanHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Converte códigos de unidade da Jadlog em localização sem expor a origem por engano. */
export function normalizeJadlogLocation(value: unknown): string {
  const raw = cleanHtml(String(value || ''));
  const withoutPrefix = raw.replace(/^(?:CO|FL|MT)\s+/i, '').trim();
  if (/^GOV(?:ERNADOR)?\s+VALADARES(?:\s+\d+)?$/i.test(withoutPrefix)) return 'Governador Valadares';
  if (/^JADLOG\s+SEDE$/i.test(withoutPrefix)) return '';
  return withoutPrefix.replace(/\s+\d+$/g, '').trim();
}

/** A página pública da Frenet já devolve as movimentações Jadlog no HTML, da mais nova à mais antiga. */
export function parseFrenetPublicTrackingHtml(html: string): RealEvent[] {
  const events: RealEvent[] = [];
  const blocks = String(html || '').matchAll(
    /<div class="tracking-item">[\s\S]*?<div class="title">([\s\S]*?)<\/div>\s*<div class="details">([\s\S]*?)<\/div>/gi,
  );
  for (const block of blocks) {
    const description = cleanHtml(block[1]);
    const details = cleanHtml(block[2]);
    const match = details.match(/^(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)\s*(?:-\s*(.*))?$/);
    if (!description || !match) continue;
    events.push({
      at: parseFrenetDate(match[1]),
      description,
      location: normalizeJadlogLocation(match[2] || ''),
      type: 'JADLOG',
    });
  }
  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * NÃO REMOVER: a API oficial reconhece F_3/Jadlog, mas devolve zero eventos para
 * esses códigos. A página pública é a reserva SOMENTE para Jadlog, com 8 s de
 * limite e sem repetição; qualquer falha retorna null e preserva o fluxo atual.
 */
export async function fetchFrenetPublicEvents(
  carrierPath = 'JAD',
  trackingNumber: string,
): Promise<{ events: RealEvent[]; serviceCode: string } | null> {
  const code = String(trackingNumber || '').trim();
  if (carrierPath.toUpperCase() !== 'JAD' || !/^\d{8,14}$/.test(code)) return null;
  try {
    const response = await fetch(`https://rastreio.frenet.com.br/JAD/${encodeURIComponent(code)}`, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const events = parseFrenetPublicTrackingHtml(await response.text());
    return events.length ? { events, serviceCode: SERVICE_CODES.jadlog } : null;
  } catch {
    return null;
  }
}

/**
 * Busca os eventos reais. Se o serviço não for conhecido, tenta SEDEX e PAC.
 * Retorna também o código de serviço que funcionou, para guardar em cache.
 */
export async function fetchFrenetEvents(
  trackingNumber: string,
  serviceCode?: string | null,
  source?: { carrier?: string | null; trackingUrl?: string | null },
): Promise<{ events: RealEvent[]; serviceCode: string } | null> {
  const token = Deno.env.get('FRENET_TOKEN');
  if (!token || !trackingNumber) return null;

  const jadlog = isJadlogTrackingSource(source?.carrier, source?.trackingUrl);
  const byFormat = candidatesForCode(trackingNumber);
  // Jadlog conhecida consulta só o próprio serviço antes da reserva pública;
  // não tenta códigos de outras transportadoras para o mesmo número.
  const candidates = jadlog
    ? [SERVICE_CODES.jadlog]
    : serviceCode
      ? [serviceCode, ...byFormat.filter((c) => c !== serviceCode)]
      : byFormat;

  for (const code of candidates) {
    try {
      const raw = await callFrenet(token, code, trackingNumber);
      if (!raw) continue;
      const events: RealEvent[] = raw.map((ev: any) => ({
        at: parseFrenetDate(ev?.EventDateTime),
        description: String(ev?.EventDescription ?? ''),
        location: String(ev?.EventLocation ?? ''),
        type: String(ev?.EventType ?? ''),
        status: ev?.EventStatus != null ? String(ev.EventStatus) : undefined,
      }));
      return { events, serviceCode: code };
    } catch (e) {
      console.error('Frenet tracking error', code, (e as Error).message);
    }
  }
  return jadlog ? fetchFrenetPublicEvents('JAD', trackingNumber) : null;
}

/** Mescla eventos novos nos já conhecidos, sem duplicar. */
export function mergeRealEvents(existing: RealEvent[], incoming: RealEvent[]): RealEvent[] {
  const merged = [...existing];
  for (const item of incoming) {
    const dup = merged.some(
      (e) => e.at === item.at && e.description === item.description && e.location === item.location,
    );
    if (!dup) merged.push(item);
    else if (item.status) {
      const known = merged.find((e) => e.at === item.at && e.description === item.description && e.location === item.location);
      if (known && !known.status) Object.assign(known, { status: item.status, type: item.type || known.type });
    }
  }
  merged.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return merged;
}

// Entrega confirmada: regra única em delivery-event.ts (insucesso nunca vira entrega).
export const isDeliveredEvent = (
  description: string,
  carrier?: string | null,
  ev?: { type?: string | null; status?: string | null },
) => isRealDeliveryEvent({ description, type: ev?.type, status: ev?.status }, carrier);
