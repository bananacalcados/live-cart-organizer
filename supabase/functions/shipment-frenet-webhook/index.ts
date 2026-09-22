// Recebe os avisos de rastreio da Frenet e atualiza o acompanhamento do cliente.
// A Frenet envia apenas o ÚLTIMO evento a cada mudança de status.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

const TOKEN_HEADER = 'frenet_integration';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const expected = Deno.env.get('FRENET_WEBHOOK_TOKEN');
  if (expected) {
    const got = req.headers.get(TOKEN_HEADER) || req.headers.get('x-frenet-token') || '';
    if (got !== expected) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const body = await req.json();
    const trackingNumber = String(body?.TrackingNumber ?? '').trim();
    const orderId = String(body?.OrderId ?? '').trim();
    const incoming = Array.isArray(body?.TrackingEvents) ? body.TrackingEvents : [];

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let row: any = null;
    if (trackingNumber) {
      const { data } = await supabase
        .from('shipment_simulations')
        .select('id, real_events, fulfillment, delivered_at')
        .eq('real_tracking_code', trackingNumber)
        .maybeSingle();
      row = data;
    }
    if (!row && orderId) {
      const { data } = await supabase
        .from('shipment_simulations')
        .select('id, real_events, fulfillment, delivered_at')
        .or(`order_reference.eq.${orderId},sale_id.eq.${orderId}`)
        .maybeSingle();
      row = data;
    }

    if (!row) {
      // Respondemos 200 para a Frenet não reenviar indefinidamente.
      console.log('Frenet webhook: envio não encontrado', { trackingNumber, orderId });
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parseDate = (s: string) => {
      const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})/);
      if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 3, +m[5])).toISOString();
      const d = new Date(s);
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    };

    const existing: any[] = Array.isArray(row.real_events) ? row.real_events : [];
    const merged = [...existing];
    let delivered = row.delivered_at as string | null;

    for (const ev of incoming) {
      const item = {
        at: parseDate(ev?.EventDateTime),
        description: String(ev?.EventDescription ?? ''),
        location: String(ev?.EventLocation ?? ''),
        type: String(ev?.EventType ?? ''),
      };
      const dup = merged.some(
        (e) => e.at === item.at && e.description === item.description && e.location === item.location,
      );
      if (!dup) merged.push(item);
      if (/entregue|delivered/i.test(item.description)) delivered = item.at;
    }

    merged.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    const { error } = await supabase
      .from('shipment_simulations')
      .update({
        real_events: merged,
        real_tracking_code: trackingNumber || undefined,
        last_real_sync: new Date().toISOString(),
        delivered_at: delivered,
        stage: delivered ? 'entregue' : 'enviado',
        status: delivered ? 'delivered' : 'active',
      })
      .eq('id', row.id);
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, matched: true, events: merged.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Frenet webhook error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
