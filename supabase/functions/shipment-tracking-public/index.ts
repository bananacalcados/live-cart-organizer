import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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
    if (!/^[A-Z0-9]{5,30}$/.test(code)) {
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
      .select('tracking_code, origin_city, origin_state, destination_city, destination_state, stops, posted_at, step_interval_days, manual_offset_days, status')
      .eq('tracking_code', code)
      .maybeSingle();

    if (error) throw error;
    if (!sim) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stops: SimStop[] = Array.isArray(sim.stops) ? (sim.stops as SimStop[]) : [];
    const interval = Math.max(1, Number(sim.step_interval_days) || 2);
    const posted = new Date(sim.posted_at as string);
    const offsetMs = (Number(sim.manual_offset_days) || 0) * 86400000;
    const at = (i: number) =>
      withNaturalTime(new Date(posted.getTime() + i * interval * 86400000 - offsetMs), code, i).toISOString();

    const path: SimStop[] = [
      { city: sim.origin_city as string, state: sim.origin_state as string },
      ...stops,
      { city: sim.destination_city as string, state: sim.destination_state as string },
    ];

    const events: Array<{ title: string; detail?: string; city: string; state: string; at: string }> = [];
    events.push({
      title: 'Objeto postado',
      city: path[0].city,
      state: path[0].state,
      at: withNaturalTime(new Date(posted.getTime() - offsetMs), code, 0).toISOString(),
    });
    let index = 0;
    for (let i = 1; i < path.length; i++) {
      index = i;
      events.push({
        title: 'Objeto em trânsito',
        detail: `de ${path[i - 1].city}/${path[i - 1].state} para ${path[i].city}/${path[i].state}`,
        city: path[i - 1].city,
        state: path[i - 1].state,
        at: at(i),
      });
    }
    index += 1;
    events.push({
      title: 'Objeto saiu para entrega ao destinatário',
      city: path[path.length - 1].city,
      state: path[path.length - 1].state,
      at: at(index),
    });
    index += 1;
    events.push({
      title: 'Objeto entregue ao destinatário',
      city: path[path.length - 1].city,
      state: path[path.length - 1].state,
      at: at(index),
    });

    const now = Date.now();
    const passed = sim.status === 'delivered'
      ? events
      : events.filter((e) => new Date(e.at).getTime() <= now);
    const visible = (passed.length ? passed : [events[0]]).reverse();

    return new Response(
      JSON.stringify({
        tracking_code: code,
        status: visible[0]?.title ?? 'Objeto postado',
        posted_at: events[0].at,
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
