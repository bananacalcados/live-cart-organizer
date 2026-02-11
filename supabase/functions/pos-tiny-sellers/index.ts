import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id } = await req.json();
    if (!store_id) throw new Error('store_id is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: store } = await supabase
      .from('pos_stores')
      .select('tiny_token')
      .eq('id', store_id)
      .single();

    if (!store?.tiny_token) throw new Error('Store token not configured');

    // Fetch sellers from Tiny
    const resp = await fetch('https://api.tiny.com.br/api2/vendedores.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${store.tiny_token}&formato=json&pesquisa=`,
    });

    const data = await resp.json();
    const rawSellers = data.retorno?.vendedores || [];

    const sellers = rawSellers.map((item: any) => {
      const v = item.vendedor || item;
      return {
        tiny_id: String(v.id || ''),
        name: v.nome || 'Sem nome',
        situacao: v.situacao || 'A',
      };
    }).filter((s: any) => s.situacao === 'A' || s.situacao === 'Ativo');

    console.log(`Found ${sellers.length} active sellers from Tiny`);

    // Sync sellers to pos_sellers table
    for (const seller of sellers) {
      const { data: existing } = await supabase
        .from('pos_sellers')
        .select('id')
        .eq('store_id', store_id)
        .eq('tiny_seller_id', seller.tiny_id)
        .maybeSingle();

      if (!existing) {
        await supabase.from('pos_sellers').insert({
          store_id,
          name: seller.name,
          tiny_seller_id: seller.tiny_id,
          is_active: true,
        });
      }
    }

    // Return updated sellers from DB
    const { data: dbSellers } = await supabase
      .from('pos_sellers')
      .select('*')
      .eq('store_id', store_id)
      .eq('is_active', true)
      .order('name');

    return new Response(JSON.stringify({ success: true, sellers: dbSellers || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message, sellers: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
