import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { isAuthorizedCron, unauthorizedResponse } from '../_shared/cron-guard.ts';
import { fetchCorreiosEvents } from '../_shared/correios-tracking.ts';
import { fetchFrenetEvents, guessServiceCode, isDeliveredEvent, mergeRealEvents } from '../_shared/frenet-tracking.ts';

const Body = z.object({ limit: z.number().int().min(1).max(25).default(25), sale_id: z.string().uuid().optional() });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Reprocessamento manual em pequenos lotes; não cria cron nem consulta em loop pelo navegador. */
Deno.serve(withAccessLog('shipment-tracking-backfill', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(corsHeaders);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: 'Lote inválido' }, 400);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let query = sb.from('shipment_simulations')
    .select('id,sale_id,real_tracking_code,real_carrier,real_service_code,real_events,delivered_at,last_real_sync')
    .eq('kind', 'order').is('merged_into_id', null).is('delivered_at', null).is('last_real_sync', null)
    .not('real_tracking_code', 'is', null)
    .gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
    .order('created_at', { ascending: true }).limit(parsed.data.limit);
  if (parsed.data.sale_id) query = query.eq('sale_id', parsed.data.sale_id);
  const { data: rows, error } = await query;
  if (error) return json({ error: error.message }, 500);

  let synced = 0, delivered = 0, eventsSaved = 0;
  const failures: { id: string; error: string }[] = [];
  for (const sim of rows ?? []) {
    // Marca a tentativa antes do provedor: outra chamada não repete o mesmo lote.
    await sb.from('shipment_simulations').update({ last_real_sync: new Date().toISOString() }).eq('id', sim.id).is('last_real_sync', null);
    try {
      const trackingCode = String(sim.real_tracking_code).trim().toUpperCase();
      let nativeShipment: { servico_codigo: string } | null = null;
      if (sim.sale_id && /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode)) {
        const { data, error: nativeError } = await sb.from('correios_shipments').select('servico_codigo')
          .eq('codigo_objeto', trackingCode).contains('sale_ids', [sim.sale_id])
          .not('status', 'in', '(cancelada,erro)').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (nativeError) throw nativeError;
        nativeShipment = data;
      }
      const fetched = nativeShipment
        ? await fetchCorreiosEvents(sb, trackingCode)
        : await fetchFrenetEvents(trackingCode, sim.real_service_code || guessServiceCode(sim.real_carrier));
      if (!fetched) { failures.push({ id: sim.id, error: 'transportadora_sem_eventos_ou_indisponivel' }); continue; }
      const merged = mergeRealEvents(Array.isArray(sim.real_events) ? sim.real_events : [], fetched.events);
      const deliveredEvent = [...merged].reverse().find((e) => isDeliveredEvent(e.description, sim.real_carrier));
      const patch: Record<string, unknown> = {
        real_events: merged, real_service_code: nativeShipment?.servico_codigo || ('serviceCode' in fetched ? fetched.serviceCode : null),
        last_real_sync: new Date().toISOString(),
      };
      if (deliveredEvent) Object.assign(patch, { delivered_at: deliveredEvent.at, stage: 'entregue', status: 'delivered', delivered_source: 'carrier', delivery_estimate: null });
      const { error: updateError } = await sb.from('shipment_simulations').update(patch).eq('id', sim.id);
      if (updateError) throw updateError;
      synced++; eventsSaved += merged.length; if (deliveredEvent) delivered++;
    } catch (e) {
      failures.push({ id: sim.id, error: String((e as Error)?.message || e).slice(0, 300) });
    }
  }
  return json({ ok: true, claimed: rows?.length ?? 0, synced, delivered, events_saved: eventsSaved, failures });
}));
