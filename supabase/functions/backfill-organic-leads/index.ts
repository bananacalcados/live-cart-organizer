import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1) Get all unique phones from incoming whatsapp_messages in last 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const sinceISO = threeMonthsAgo.toISOString();

    console.log(`Backfilling organic leads since ${sinceISO}`);

    // Fetch incoming messages with distinct phones, paginated
    const allPhones = new Map<string, { name: string | null; firstContact: string }>();
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('phone, sender_name, created_at')
        .eq('direction', 'incoming')
        .eq('is_group', false)
        .gte('created_at', sinceISO)
        .order('created_at', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) { console.error('Query error:', error); break; }
      if (!data || data.length === 0) break;

      for (const msg of data) {
        const phone = msg.phone?.replace(/\D/g, '');
        if (!phone || phone.length < 10) continue;
        if (!allPhones.has(phone)) {
          allPhones.set(phone, {
            name: msg.sender_name || null,
            firstContact: msg.created_at,
          });
        }
      }

      if (data.length < pageSize) break;
      from += pageSize;
    }

    console.log(`Found ${allPhones.size} unique incoming phones`);

    // 2) Exclude known customers
    const phonesToCheck = [...allPhones.keys()];
    const customerPhones = new Set<string>();

    // Check in batches of 100 using suffix matching
    for (let i = 0; i < phonesToCheck.length; i += 100) {
      const batch = phonesToCheck.slice(i, i + 100);
      for (const phone of batch) {
        const suffix = phone.slice(-8);
        const [{ data: zoppy }, { data: pos }] = await Promise.all([
          supabase.from('zoppy_customers').select('id').or(`phone.ilike.%${suffix}`).limit(1).maybeSingle(),
          supabase.from('pos_customers').select('id').or(`whatsapp.ilike.%${suffix}`).limit(1).maybeSingle(),
        ]);
        if (zoppy || pos) customerPhones.add(phone);
      }
    }

    console.log(`Excluded ${customerPhones.size} known customers`);

    // 3) Exclude phones that already have lp_leads entries
    const existingLeadPhones = new Set<string>();
    let leadsFrom = 0;
    while (true) {
      const { data, error } = await supabase
        .from('lp_leads')
        .select('phone')
        .not('phone', 'is', null)
        .range(leadsFrom, leadsFrom + 999);
      if (error || !data || data.length === 0) break;
      for (const l of data) {
        if (l.phone) existingLeadPhones.add(l.phone.replace(/\D/g, ''));
      }
      if (data.length < 1000) break;
      leadsFrom += 1000;
    }

    console.log(`Excluded ${existingLeadPhones.size} existing leads`);

    // 4) Insert organic leads with weekly campaign tags
    let inserted = 0;
    const toInsert: Array<{ name: string | null; phone: string; campaign_tag: string; source: string; converted: boolean; metadata: any }> = [];

    for (const [phone, info] of allPhones) {
      if (customerPhones.has(phone)) continue;
      if (existingLeadPhones.has(phone)) continue;

      const contactDate = new Date(info.firstContact);
      const dayOfMonth = contactDate.getDate();
      const weekNum = dayOfMonth <= 7 ? 1 : dayOfMonth <= 14 ? 2 : dayOfMonth <= 21 ? 3 : 4;
      const mm = String(contactDate.getMonth() + 1).padStart(2, '0');
      const yy = String(contactDate.getFullYear()).slice(-2);
      const campaignTag = `contato-whats-${weekNum}-${mm}-${yy}`;

      toInsert.push({
        name: info.name || null,
        phone,
        campaign_tag: campaignTag,
        source: 'organic_whatsapp_backfill',
        converted: false,
        metadata: { captured_at: info.firstContact, backfilled: true },
      });
    }

    // Insert in batches of 100
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100);
      const { error } = await supabase.from('lp_leads').insert(batch);
      if (error) {
        console.error(`Insert batch error at ${i}:`, error);
      } else {
        inserted += batch.length;
      }
    }

    console.log(`Backfill complete: ${inserted} organic leads inserted`);

    return new Response(
      JSON.stringify({ success: true, total_phones: allPhones.size, customers_excluded: customerPhones.size, existing_leads_excluded: existingLeadPhones.size, inserted }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Backfill error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
