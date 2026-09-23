// Consulta sob demanda do rastreio real na Frenet.
// Nunca expõe transportadora ou código real ao cliente — uso interno apenas.

export type RealEvent = {
  at: string;
  description: string;
  location: string;
  type?: string;
};

const FRENET_URL = 'https://api.frenet.com.br/tracking/trackinginfo';

/** Códigos de serviço da conta (SEDEX / PAC). */
export const SERVICE_CODES = { sedex: '03220', pac: '03298' } as const;

export function parseFrenetDate(s: string): string {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 3, +m[5])).toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Adivinha o código de serviço a partir do nome salvo internamente. */
export function guessServiceCode(carrier?: string | null): string | null {
  const c = String(carrier || '').toLowerCase();
  if (c.includes('sedex')) return SERVICE_CODES.sedex;
  if (c.includes('pac')) return SERVICE_CODES.pac;
  return null;
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

/**
 * Busca os eventos reais. Se o serviço não for conhecido, tenta SEDEX e PAC.
 * Retorna também o código de serviço que funcionou, para guardar em cache.
 */
export async function fetchFrenetEvents(
  trackingNumber: string,
  serviceCode?: string | null,
): Promise<{ events: RealEvent[]; serviceCode: string } | null> {
  const token = Deno.env.get('FRENET_TOKEN');
  if (!token || !trackingNumber) return null;

  const candidates = serviceCode
    ? [serviceCode]
    : [SERVICE_CODES.sedex, SERVICE_CODES.pac];

  for (const code of candidates) {
    try {
      const raw = await callFrenet(token, code, trackingNumber);
      if (!raw) continue;
      const events: RealEvent[] = raw.map((ev: any) => ({
        at: parseFrenetDate(ev?.EventDateTime),
        description: String(ev?.EventDescription ?? ''),
        location: String(ev?.EventLocation ?? ''),
        type: String(ev?.EventType ?? ''),
      }));
      return { events, serviceCode: code };
    } catch (e) {
      console.error('Frenet tracking error', code, (e as Error).message);
    }
  }
  return null;
}

/** Mescla eventos novos nos já conhecidos, sem duplicar. */
export function mergeRealEvents(existing: RealEvent[], incoming: RealEvent[]): RealEvent[] {
  const merged = [...existing];
  for (const item of incoming) {
    const dup = merged.some(
      (e) => e.at === item.at && e.description === item.description && e.location === item.location,
    );
    if (!dup) merged.push(item);
  }
  merged.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return merged;
}

export const isDeliveredEvent = (description: string) => /entregue|delivered/i.test(description);
