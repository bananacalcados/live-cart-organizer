import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    // Get all active stores with tiny tokens
    const { data: stores } = await supabase
      .from('pos_stores').select('id, name, tiny_token')
      .not('tiny_token', 'is', null).eq('is_active', true);

    if (!stores?.length) throw new Error('No stores with Tiny token found');

    const allCategories = new Map<string, { name: string; tipo: string }>();

    // Fetch categories from each store (they share similar categories)
    for (const store of stores) {
      try {
        // Tiny doesn't have a dedicated categories endpoint, but we can extract from accounts payable
        // Use contas.pagar.pesquisa to extract unique categories
        const resp = await fetch('https://api.tiny.com.br/api2/contas.pagar.pesquisa.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: store.tiny_token, formato: 'json', situacao: 'aberto', pagina: '1' }).toString(),
        });
        const data = await resp.json();
        const contas = data.retorno?.contas || [];

        for (const item of contas) {
          const conta = item.conta;
          if (conta.categoria && !allCategories.has(conta.categoria)) {
            allCategories.set(conta.categoria, { name: conta.categoria, tipo: 'expense' });
          }
        }

        // Also fetch paid ones for more categories
        const resp2 = await fetch('https://api.tiny.com.br/api2/contas.pagar.pesquisa.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: store.tiny_token, formato: 'json', situacao: 'pago', pagina: '1' }).toString(),
        });
        const data2 = await resp2.json();
        for (const item of (data2.retorno?.contas || [])) {
          const conta = item.conta;
          if (conta.categoria && !allCategories.has(conta.categoria)) {
            allCategories.set(conta.categoria, { name: conta.categoria, tipo: 'expense' });
          }
        }

        // Also try contas a receber for income categories
        await new Promise(r => setTimeout(r, 1000));
        const resp3 = await fetch('https://api.tiny.com.br/api2/contas.receber.pesquisa.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: store.tiny_token, formato: 'json', situacao: 'aberto', pagina: '1' }).toString(),
        });
        const data3 = await resp3.json();
        for (const item of (data3.retorno?.contas || [])) {
          const conta = item.conta;
          if (conta.categoria && !allCategories.has(conta.categoria)) {
            allCategories.set(conta.categoria, { name: conta.categoria, tipo: 'income' });
          }
        }
      } catch (e) {
        console.error(`Error fetching categories from ${store.name}:`, e);
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    // Upsert categories
    let synced = 0;
    for (const [name, info] of allCategories) {
      const { error } = await supabase.from('financial_categories').upsert({
        name,
        type: info.tipo,
        tiny_category_id: name, // Use name as ID since Tiny doesn't have numeric category IDs in search
        is_custom: false,
      }, { onConflict: 'tiny_category_id' });
      if (!error) synced++;
    }

    return new Response(JSON.stringify({ success: true, synced, total: allCategories.size }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
