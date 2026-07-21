import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const horizon = Number(body.horizon_days ?? 60);
    const storeId: string | null = body.store_id ?? null;
    const force: boolean = body.force === true;

    if (![30, 60, 90].includes(horizon)) {
      return json({ error: 'horizon_days must be 30, 60 or 90' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const applyStoreFilter = <T extends { eq: any; is: any }>(q: T): T =>
      (storeId === null ? q.is('store_id', null) : q.eq('store_id', storeId));

    // 1) Try cache
    if (!force) {
      const { data: cached } = await applyStoreFilter(
        admin.from('inventory_health_cache')
          .select('payload, computed_at')
          .eq('horizon_days', horizon)
      ).maybeSingle();

      if (cached) {
        const age = Date.now() - new Date(cached.computed_at).getTime();
        if (age < CACHE_TTL_MS) {
          return json({ ...(cached.payload as any), cached: true, computed_at: cached.computed_at });
        }
      }
    }

    // 2) Compute (edge tem timeout ~150s, muito maior que Data API)
    const { data: payload, error } = await admin.rpc('calculate_inventory_health', {
      p_horizon_days: horizon,
      p_store_id: storeId,
    });

    if (error) {
      console.error('RPC error:', error);
      return json({ error: error.message }, 500);
    }

    // 3) Replace cache row (unique index uses COALESCE — simpler to delete+insert)
    const computed_at = new Date().toISOString();
    await applyStoreFilter(
      admin.from('inventory_health_cache').delete().eq('horizon_days', horizon)
    );
    await admin.from('inventory_health_cache')
      .insert({ store_id: storeId, horizon_days: horizon, payload, computed_at });

    return json({ ...(payload as any), cached: false, computed_at });
  } catch (e) {
    console.error('unhandled:', e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
