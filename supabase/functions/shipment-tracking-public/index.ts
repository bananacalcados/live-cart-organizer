import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  DEFAULT_STAGE_CONFIG,
  INCIDENT_LABEL,
  IncidentType,
  POST_SHIPPED_STEPS,
  PICKUP_LABEL,
  PublicEvent,
  STAGE_DETAIL,
  STAGE_LABEL,
  STAGE_ORDER,
  StageConfig,
  StageKey,
  autoStage,
  clampStageConfig,
  naturalTime,
  sanitize,
  stageTimes,
  translateRealEvent,
} from '../_shared/shipment-stages.ts';
import {
  fetchFrenetEvents,
  guessServiceCode,
  isDeliveredEvent,
  mergeRealEvents,
} from '../_shared/frenet-tracking.ts';

/** Intervalo mínimo entre consultas à transportadora (cache). */
const SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SimStop = { city: string; state: string };

const seedFrom = (code: string) => {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return h;
};

const withNaturalTime = (base: Date, code: string, index: number) => {
  const seed = seedFrom(code + ':' + index);
  const d = new Date(base);
  d.setUTCHours(11 + (seed % 11), (seed >> 4) % 60, (seed >> 9) % 60, 0);
  return d;
};

/** Modelo antigo: simulação manual por rota de cidades. */
function legacyTimeline(sim: any, code: string): PublicEvent[] {
  const stops: SimStop[] = Array.isArray(sim.stops) ? (sim.stops as SimStop[]) : [];
  const interval = Math.max(1, Number(sim.step_interval_days) || 2);
  const posted = new Date(sim.posted_at as string);
  const offsetMs = (Number(sim.manual_offset_days) || 0) * 86400000;
  const at = (i: number) =>
    withNaturalTime(new Date(posted.getTime() + i * interval * 86400000 - offsetMs), code, i).toISOString();

  const path: SimStop[] = [
    { city: sim.origin_city, state: sim.origin_state },
    ...stops,
    { city: sim.destination_city, state: sim.destination_state },
  ].filter((p) => p.city);

  const events: PublicEvent[] = [];
  events.push({
    title: 'Pedido enviado',
    city: path[0]?.city,
    state: path[0]?.state,
    at: withNaturalTime(new Date(posted.getTime() - offsetMs), code, 0).toISOString(),
  });
  let index = 0;
  for (let i = 1; i < path.length; i++) {
    index = i;
    events.push({
      title: 'Pedido em trânsito',
      detail: `de ${path[i - 1].city}/${path[i - 1].state} para ${path[i].city}/${path[i].state}`,
      city: path[i - 1].city,
      state: path[i - 1].state,
      at: at(i),
    });
  }
  index += 1;
  events.push({
    title: 'Saiu para entrega',
    city: path[path.length - 1]?.city,
    state: path[path.length - 1]?.state,
    at: at(index),
  });
  return events;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    let code = url.searchParams.get('code') ?? '';
    if (!code && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      code = String(body?.code ?? '');
    }
    code = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{5,30}$/.test(code)) {
      return new Response(JSON.stringify({ error: 'Código inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: sim, error } = await supabase
      .from('shipment_simulations')
      .select('*')
      .eq('tracking_code', code)
      .maybeSingle();

    if (error) throw error;
    if (!sim) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    let events: PublicEvent[] = [];
    let statusLabel = '';

    // Para acompanhamentos de pedido, completa os dados públicos diretamente
    // da venda quando registros antigos ainda não trouxerem nome ou destino.
    if (sim.kind === 'order' && sim.sale_id &&
      (!sim.customer_name || !sim.destination_city || !sim.destination_state)) {
      const { data: sale } = await supabase
        .from('pos_sales')
        .select('customer_name, customer_city, customer_state, shipping_address')
        .eq('id', sim.sale_id)
        .maybeSingle();
      if (sale) {
        const address = sale.shipping_address && typeof sale.shipping_address === 'object'
          ? sale.shipping_address as Record<string, unknown>
          : {};
        sim.customer_name = sim.customer_name || sale.customer_name;
        sim.destination_city = sim.destination_city || sale.customer_city || address.city || address.cidade;
        sim.destination_state = sim.destination_state || sale.customer_state || address.state || address.uf || address.province;
      }
    }

    // Consulta sob demanda: quando o cliente abre o link e já existe código real,
    // buscamos a posição atual na transportadora (com cache de algumas horas).
    if (
      sim.kind === 'order' &&
      sim.real_tracking_code &&
      !sim.delivered_at &&
      (!sim.last_real_sync ||
        now.getTime() - new Date(sim.last_real_sync as string).getTime() > SYNC_INTERVAL_MS)
    ) {
      try {
        const fetched = await fetchFrenetEvents(
          String(sim.real_tracking_code),
          (sim.real_service_code as string | null) || guessServiceCode(sim.real_carrier as string | null),
        );
        const patch: Record<string, unknown> = { last_real_sync: now.toISOString() };
        if (fetched) {
          const merged = mergeRealEvents(
            Array.isArray(sim.real_events) ? (sim.real_events as any[]) : [],
            fetched.events,
          );
          const delivered = [...merged].reverse().find((e) => isDeliveredEvent(e.description));
          patch.real_events = merged;
          patch.real_service_code = fetched.serviceCode;
          if (delivered) {
            patch.delivered_at = delivered.at;
            patch.stage = 'entregue';
            patch.status = 'delivered';
          }
          sim.real_events = merged;
          if (delivered) {
            sim.delivered_at = delivered.at;
            sim.stage = 'entregue';
          }
        }
        await supabase.from('shipment_simulations').update(patch).eq('id', sim.id);
      } catch (e) {
        console.error('Frenet sync falhou', (e as Error).message);
      }
    }

    if (sim.kind === 'order') {
      const { data: cfgRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'shipment_stage_config')
        .maybeSingle();
      const base: StageConfig = { ...DEFAULT_STAGE_CONFIG, ...(cfgRow?.value as any || {}) };
      const cfg: StageConfig = clampStageConfig({ ...base, ...((sim.stage_days as any) || {}) });

      const fulfillment = String(sim.fulfillment || 'carrier');
      const labels = fulfillment === 'pickup' ? PICKUP_LABEL : STAGE_LABEL;
      const started = new Date(sim.stage_started_at as string);
      const times = stageTimes(started, cfg);
      const history = (sim.stage_history as Record<string, string>) || {};
      const persisted = String(sim.stage || 'em_separacao') as StageKey;
      const auto = autoStage(started, cfg, now);
      const reached: StageKey =
        STAGE_ORDER.indexOf(persisted) >= STAGE_ORDER.indexOf(auto) ? persisted : auto;

      const stageAt = (k: StageKey, fallback: Date, i: number) =>
        history[k] ? new Date(history[k]).toISOString() : naturalTime(fallback, code, i);

      const autoStages: StageKey[] = ['em_separacao', 'separado', 'embalado'];
      autoStages.forEach((k, i) => {
        if (STAGE_ORDER.indexOf(reached) >= STAGE_ORDER.indexOf(k)) {
          events.push({
            title: labels[k],
            detail: STAGE_DETAIL[k],
            at: stageAt(k, (times as any)[k], i),
          });
        }
      });

      if (STAGE_ORDER.indexOf(reached) >= STAGE_ORDER.indexOf('enviado')) {
        events.push({
          title: labels.enviado,
          detail: fulfillment === 'pickup'
            ? 'Seu pedido está pronto para retirada na loja.'
            : STAGE_DETAIL.enviado,
          at: stageAt('enviado', now, 3),
        });
      }

      // Enquanto o código real não é registrado na Conferência, damos sensação de
      // movimento com duas linhas genéricas contadas a partir do "enviado".
      if (
        STAGE_ORDER.indexOf(reached) >= STAGE_ORDER.indexOf('enviado') &&
        fulfillment !== 'pickup' &&
        !sim.real_tracking_code &&
        !sim.delivered_at
      ) {
        const shippedAt = new Date(events[events.length - 1]?.at || now);
        POST_SHIPPED_STEPS.forEach((step, i) => {
          const when = addDays(shippedAt, step.days, cfg.business_days);
          if (when.getTime() > now.getTime()) return;
          events.push({
            title: step.title,
            detail: step.detail,
            at: naturalTime(when, code, 10 + i),
          });
        });
      }

      // Eventos reais da transportadora, já traduzidos e sem citar a empresa.
      const real = Array.isArray(sim.real_events) ? (sim.real_events as any[]) : [];
      const sentAt = events.length ? new Date(events[events.length - 1].at).getTime() : 0;
      let last = sentAt;

      const norm = (s: string) =>
        String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const cityOf = (ev: any) => {
        const loc = sanitize(String(ev.location || ev.EventLocation || ''));
        const [city, state] = loc.split(/[\/-]/).map((s: string) => s.trim());
        return { city: city || '', state: state || '' };
      };
      // Cidade de origem: a da primeira movimentação real (onde o pedido foi postado).
      const originCity = norm(
        String(sim.origin_city || '') || (real.map(cityOf).find((c) => c.city)?.city ?? ''),
      );

      for (const ev of real) {
        const when = new Date(ev.at || ev.EventDateTime || now).getTime();
        const tr = translateRealEvent(String(ev.description || ev.EventDescription || ''), fulfillment);
        if (!tr) continue;
        const { city, state } = cityOf(ev);
        // Escondemos as movimentações que ainda estão na nossa própria cidade
        // (pré-postagem, postagem e primeira transferência): o cliente já viu
        // "Pedido enviado" e não pode perceber a diferença de datas.
        const atOrigin = !city || (originCity && norm(city) === originCity);
        if (atOrigin && tr.title === 'Pedido em trânsito') continue;
        // Trava de coerência: nunca voltar no tempo.
        const at = new Date(Math.max(when, last + 60000));
        last = at.getTime();
        events.push({
          title: tr.title,
          detail: tr.detail,
          city: city || undefined,
          state: state || undefined,
          at: at.toISOString(),
        });
      }

      // Nunca mostramos entrega por conta própria: só quando o evento real diz.
      events = events.filter((e) => new Date(e.at).getTime() <= now.getTime() + 60000);
      statusLabel = events[events.length - 1]?.title ?? labels.em_separacao;
    } else {
      const all = legacyTimeline(sim, code);
      const passed = all.filter((e) => new Date(e.at).getTime() <= now.getTime());
      events = passed.length ? passed : [all[0]];
      statusLabel = events[events.length - 1]?.title ?? 'Pedido enviado';
    }

    const visible = [...events].reverse();

    return new Response(
      JSON.stringify({
        tracking_code: code,
        status: statusLabel,
        customer_name: (sim.customer_name as string | null) ?? null,
        destination_city: (sim.destination_city as string | null) ?? null,
        destination_state: (sim.destination_state as string | null) ?? null,
        order_reference: (sim.order_reference as string | null) ?? null,
        posted_at: events[0]?.at ?? null,
        events: visible,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
