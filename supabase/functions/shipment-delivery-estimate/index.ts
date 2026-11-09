import { withAccessLog } from '../_shared/withAccessLog.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { isAuthorizedCron } from '../_shared/cron-guard.ts';
import { localDelivery } from '../_shared/freight-domain.ts';
import { quoteCorreiosDeliveryDays } from './correios-quote.ts';
import { buildDeliveryEstimate, isExplicitSedex } from './delivery-estimate.ts';

const bodySchema = z.object({
  shipment_id: z.string().uuid(),
  dry_run: z.boolean().default(false),
  simulated_delivery_days: z.number().int().min(0).max(60).optional(),
}).strict().refine((value) => value.dry_run || value.simulated_delivery_days == null, {
  message: 'Prazo simulado só é permitido em dry_run',
});

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const cepOf = (sale: any) => {
  const address = sale?.shipping_address && typeof sale.shipping_address === 'object' ? sale.shipping_address : {};
  return String(
    sale?.customer_cep || address.zip_code || address.zip || address.cep || address.postal_code || '',
  ).replace(/\D/g, '');
};

Deno.serve(withAccessLog('shipment-delivery-estimate', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Método não permitido' }, 405);
  if (!await isAuthorizedCron(req)) return reply({ error: 'Unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return reply({ error: 'Dados inválidos', details: parsed.error.flatten().fieldErrors }, 400);
  const input = parsed.data;
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { data: sim, error: simError } = await db.from('shipment_simulations')
      .select('id,sale_id,kind,fulfillment,merged_into_id,real_tracking_code,delivered_at,stage_started_at,delivery_estimate')
      .eq('id', input.shipment_id).maybeSingle();
    if (simError || !sim) return reply({ error: 'Acompanhamento não encontrado' }, 404);
    const current = sim.delivery_estimate as any;
    if (current?.kind === 'estimated' || current?.kind === 'confirmed') return reply({ ok: true, skipped: 'already_estimated' });
    if (current?.kind === 'quoting' && Date.parse(current.attempted_at || '') > Date.now() - 5 * 60_000) {
      return reply({ ok: true, skipped: 'quote_in_progress' });
    }
    if (current?.kind === 'unavailable') return reply({ ok: true, skipped: 'quote_unavailable' });
    if (sim.kind !== 'order' || sim.merged_into_id || sim.real_tracking_code || sim.delivered_at || sim.fulfillment === 'pickup') {
      return reply({ ok: true, skipped: 'not_eligible' });
    }

    const { data: sale, error: saleError } = await db.from('pos_sales')
      .select('id,customer_cep,shipping_address,is_sedex,shipping_type,shipping_carrier,is_store_pickup,paid_at')
      .eq('id', sim.sale_id).maybeSingle();
    if (saleError || !sale) return reply({ error: 'Venda não encontrada' }, 404);
    if (localDelivery(sale)) return reply({ ok: true, skipped: 'local_delivery_or_pickup' });
    const destination = cepOf(sale);
    if (!/^\d{8}$/.test(destination)) return reply({ ok: true, skipped: 'invalid_cep' });

    const sedex = isExplicitSedex(sale);
    const base = sale.paid_at || sim.stage_started_at;
    if (input.dry_run) {
      if (input.simulated_delivery_days == null) return reply({ error: 'Informe um prazo simulado para o dry_run' }, 400);
      const estimate = buildDeliveryEstimate({
        base, deliveryDays: input.simulated_delivery_days, sedex, quotedAt: new Date().toISOString(),
      });
      return reply({ ok: true, dry_run: true, estimate });
    }

    const attemptedAt = new Date().toISOString();
    const { data: claim, error: claimError } = await db.from('shipment_simulations')
      .update({ delivery_estimate: { kind: 'quoting', attempted_at: attemptedAt } })
      .eq('id', sim.id).is('delivery_estimate', null).is('real_tracking_code', null).is('delivered_at', null)
      .select('id').maybeSingle();
    if (claimError) throw claimError;
    if (!claim) return reply({ ok: true, skipped: 'already_claimed' });

    try {
      const days = await quoteCorreiosDeliveryDays(db, destination, sedex ? '03220' : '03298');
      const estimate = buildDeliveryEstimate({ base, deliveryDays: days, sedex, quotedAt: new Date().toISOString() });
      if (!estimate) throw new Error('Não foi possível calcular a faixa');
      const { data: saved, error: saveError } = await db.from('shipment_simulations')
        .update({ delivery_estimate: estimate })
        .eq('id', sim.id).eq('delivery_estimate->>kind', 'quoting').is('real_tracking_code', null)
        .select('id').maybeSingle();
      if (saveError) throw saveError;
      return reply(saved
        ? { ok: true, estimate: { kind: estimate.kind, start: estimate.start, end: estimate.end } }
        : { ok: true, skipped: 'real_tracking_arrived' });
    } catch (quoteError) {
      console.error('[delivery-estimate] cotação falhou', (quoteError as Error).message);
      await db.from('shipment_simulations').update({
        delivery_estimate: { kind: 'unavailable', attempted_at: new Date().toISOString(), reason: 'quote_failed' },
      }).eq('id', sim.id).eq('delivery_estimate->>kind', 'quoting').is('real_tracking_code', null);
      return reply({ error: 'Não foi possível calcular a previsão' }, 502);
    }
  } catch (error) {
    console.error('[delivery-estimate] falha', (error as Error).message);
    return reply({ error: 'Não foi possível calcular a previsão' }, 500);
  }
}));
