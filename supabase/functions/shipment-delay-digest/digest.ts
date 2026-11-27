import { classifyDeliveryEvent } from '../_shared/delivery-event.ts';
import { translateRealEvent } from '../_shared/shipment-stages.ts';

export type Event = { at: string; description: string; type?: string; status?: string };
export type Shipment = {
  id: string; customer_name: string | null; real_carrier: string | null;
  real_tracking_code: string | null; tracking_code: string;
  real_events: Event[] | null; real_post_base: string | null;
  delivery_estimate: { end?: string } | null; stage_history: { enviado?: string } | null;
  own_correios: boolean;
};
export const CATEGORIES = ['problema', 'prazo_estourado', 'parado', 'etiqueta_sem_coleta'] as const;
export type Category = typeof CATEGORIES[number];
export type Item = {
  id: string; category: Category; customer_name: string; carrier: string; real_tracking_code: string;
  tracking_code: string; days: number; last_event: Event | null; own_correios: boolean;
};
export type Groups = Record<Category, { count: number; items: Item[] }>;
const DAY = 86400000;
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const clean = (s: string) => s.replace(/[\n\r*_]/g, ' ').replace(/\s+/g, ' ').trim();

/** Datas corridas e úteis sempre no calendário de Brasília, sem depender do fuso da função. */
export function localDay(value: string | Date): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value ? value : null;
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
}
function elapsed(from: string | null | undefined, today: string, business = false): number {
  const start = from ? localDay(from) : null;
  if (!start) return 0;
  const first = Date.parse(`${start}T00:00:00Z`), end = Date.parse(`${today}T00:00:00Z`);
  if (!business) return Math.max(0, Math.floor((end-first)/DAY));
  let days = 0;
  // Mesma convenção de add_business_days: sábados e domingos não contam.
  for (let t = first+DAY; t <= end; t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return days;
}

/** NÃO REMOVER: uma categoria por envio; PROBLEMA > PRAZO > PARADO > ETIQUETA.
 * Postagem é exclusivamente shipment_real_post_base, nunca a etapa automática enviado. */
export function classifyShipment(row: Shipment, now: Date): Item | null {
  const today = localDay(now);
  if (!today) throw new Error('Data atual inválida');
  const events = (Array.isArray(row.real_events) ? row.real_events : [])
    .filter(e => e && typeof e.at === 'string' && typeof e.description === 'string' && Number.isFinite(Date.parse(e.at)))
    .slice().sort((a,b) => Date.parse(a.at)-Date.parse(b.at));
  const last = events.at(-1) ?? null;
  const text = fold(last?.description ?? '');
  const kind = last ? classifyDeliveryEvent(last, row.real_carrier) : null;
  const translated = last ? translateRealEvent(last.description,'delivery',last)?.title ?? '' : '';
  const problem = kind === 'failed_attempt' || kind === 'awaiting_pickup' || kind === 'returning'
    || /tentativa|retirada|retorno/.test(fold(translated))
    || /saida (?:para|p\/) entrega cancelada|problema|devolu|retorno|reversa/.test(text);
  let category: Category | null = null, days = 0;
  if (problem) { category = 'problema'; days = elapsed(last?.at,today); }
  else if (row.real_post_base && elapsed(row.delivery_estimate?.end,today) > 0) {
    category = 'prazo_estourado'; days = elapsed(row.delivery_estimate?.end,today);
  } else if (row.real_post_base && last && elapsed(last.at,today) >= 5) {
    category = 'parado'; days = elapsed(last.at,today);
  } else if (row.real_tracking_code && !row.real_post_base) {
    const label = events.find(e => /etiqueta emitida|\bemissao\b/.test(fold(e.description)));
    const stage = row.stage_history?.enviado;
    const labelAt = stage && localDay(stage) ? stage : label?.at;
    days = elapsed(labelAt,today,true);
    if (days >= 3) category = 'etiqueta_sem_coleta';
  }
  if (!category) return null;
  const names = clean(row.customer_name ?? '').split(' ').filter(Boolean);
  const name = names.length > 1 ? `${names[0]} ${names.at(-1)}` : names[0] || 'Cliente sem nome';
  return { id:row.id, category, customer_name:name, carrier:clean(row.real_carrier || 'Transportadora não informada'),
    real_tracking_code:clean(row.real_tracking_code || 'sem código real'), tracking_code:row.tracking_code,
    days,last_event:last,own_correios:row.own_correios };
}
export function emptyGroups(): Groups {
  return { problema:{count:0,items:[]}, prazo_estourado:{count:0,items:[]}, parado:{count:0,items:[]}, etiqueta_sem_coleta:{count:0,items:[]} };
}
export function addItem(groups: Groups, item: Item) {
  const group = groups[item.category];
  group.count++;
  group.items.push(item);
  group.items.sort((a,b) => b.days-a.days || a.id.localeCompare(b.id));
  group.items.length = Math.min(12,group.items.length);
}
const LABELS: Record<Category,string> = { problema:'Problema', prazo_estourado:'Prazo estourado', parado:'Parados há 5+ dias', etiqueta_sem_coleta:'Etiqueta sem coleta' };
function shortDate(value: string | Date) {
  const day = localDay(value);
  return day ? `${day.slice(8,10)}/${day.slice(5,7)}` : 'data não informada';
}
export function digestText(groups: Groups, now: Date): string {
  if (!CATEGORIES.some(c => groups[c].count)) return '✅ Nenhum envio com problema hoje.';
  const sections = [`📦 *Envios com problema — ${shortDate(now)}*`];
  for (const c of CATEGORIES) {
    const g = groups[c];
    if (!g.count) continue;
    const lines = g.items.map(i => {
      const last = i.last_event ? `${clean(i.last_event.description).slice(0,110)} em ${shortDate(i.last_event.at)}` : 'sem evento real';
      const unit = c === 'etiqueta_sem_coleta' ? 'dias úteis sem coleta' : c === 'prazo_estourado' ? 'dias de atraso' : c === 'parado' ? 'dias parado' : 'dias';
      return `• ${i.customer_name} — ${i.carrier} ${i.real_tracking_code} | ${clean(i.tracking_code)}${i.own_correios ? ' [Correios próprio]' : ''} — ${last} (${i.days} ${unit})`;
    });
    if (g.count > g.items.length) lines.push(`… e mais ${g.count-g.items.length}`);
    sections.push(`*${LABELS[c]} (${g.count})*\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}

/** Guarda só 12 casos por categoria em memória; dry_run jamais chama o transporte. */
export async function runDigest(options: {
  dryRun: boolean; enabled: boolean; now: Date; shipments: AsyncIterable<Shipment[]>;
  send: (text: string) => Promise<void>;
}) {
  const groups = emptyGroups();
  let scanned = 0;
  for await (const batch of options.shipments) {
    for (const row of batch) {
      scanned++;
      const item = classifyShipment(row,options.now);
      if (item) addItem(groups,item);
    }
  }
  const text = digestText(groups,options.now);
  const shouldSend = !options.dryRun && options.enabled;
  if (shouldSend) await options.send(text);
  return { dry_run:options.dryRun, sent:shouldSend, scanned, categories:groups, text };
}