import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractPhoneKey(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2);
  return digits.slice(0, 2) + digits.slice(-8);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Load all customers with phones
    let all: any[] = [];
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from('zoppy_customers')
        .select('id, phone, first_name, last_name, total_orders, total_spent, first_purchase_at, last_purchase_at, created_at')
        .not('phone', 'is', null)
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }

    // Group by phone key
    const groups = new Map<string, any[]>();
    for (const c of all) {
      const key = extractPhoneKey(c.phone);
      if (!key) continue;
      const arr = groups.get(key) || [];
      arr.push(c);
      groups.set(key, arr);
    }

    let merged = 0;
    let deleted = 0;

    for (const [_key, members] of groups) {
      if (members.length <= 1) continue;

      // Sort: most recent activity first
      members.sort((a: any, b: any) => {
        const aDate = a.last_purchase_at || '1900-01-01';
        const bDate = b.last_purchase_at || '1900-01-01';
        if (aDate !== bDate) return bDate.localeCompare(aDate);
        return (b.total_spent || 0) - (a.total_spent || 0);
      });

      const keeper = members[0];
      const duplicates = members.slice(1);

      // Sum totals from duplicates
      let addOrders = 0;
      let addSpent = 0;
      let earliestFirst = keeper.first_purchase_at;

      for (const dup of duplicates) {
        addOrders += dup.total_orders || 0;
        addSpent += dup.total_spent || 0;
        if (dup.first_purchase_at && (!earliestFirst || dup.first_purchase_at < earliestFirst)) {
          earliestFirst = dup.first_purchase_at;
        }
      }

      const newOrders = (keeper.total_orders || 0) + addOrders;
      const newSpent = (keeper.total_spent || 0) + addSpent;

      // Update keeper
      await supabase.from('zoppy_customers').update({
        total_orders: newOrders,
        total_spent: newSpent,
        avg_ticket: newOrders > 0 ? +(newSpent / newOrders).toFixed(2) : 0,
        first_purchase_at: earliestFirst,
      }).eq('id', keeper.id);

      // Delete duplicates
      const dupIds = duplicates.map((d: any) => d.id);
      for (let i = 0; i < dupIds.length; i += 50) {
        await supabase.from('zoppy_customers').delete().in('id', dupIds.slice(i, i + 50));
      }

      merged++;
      deleted += duplicates.length;
    }

    return new Response(JSON.stringify({
      success: true,
      groups_merged: merged,
      records_deleted: deleted,
      total_customers: all.length,
      message: `✅ Deduplicação: ${merged} grupos mesclados, ${deleted} registros duplicados removidos`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Dedup error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
