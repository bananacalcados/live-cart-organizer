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
    const { data: stores } = await supabase
      .from('pos_stores').select('id, name, tiny_token')
      .not('tiny_token', 'is', null).eq('is_active', true);

    if (!stores?.length) throw new Error('No stores with Tiny token found');

    const allCategories = new Map<string, { name: string; tipo: string }>();

    async function fetchAllPages(token: string, endpoint: string, situacao: string, tipo: string) {
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= 20) {
        await new Promise(r => setTimeout(r, 1200));
        try {
          const resp = await fetch(`https://api.tiny.com.br/api2/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, formato: 'json', situacao, pagina: String(page) }).toString(),
          });
          const data = await resp.json();
          const contas = data.retorno?.contas || [];
          if (contas.length === 0) { hasMore = false; break; }
          
          for (const item of contas) {
            const conta = item.conta;
            if (conta.categoria && !allCategories.has(conta.categoria)) {
              allCategories.set(conta.categoria, { name: conta.categoria, tipo });
            }
          }
          
          const numPages = data.retorno?.numero_paginas || 1;
          if (page >= numPages) hasMore = false;
          page++;
        } catch (e) {
          console.error(`Error page ${page}:`, e);
          hasMore = false;
        }
      }
    }

    for (const store of stores) {
      // Fetch ALL pages of contas a pagar (open + paid)
      await fetchAllPages(store.tiny_token, 'contas.pagar.pesquisa.php', 'aberto', 'expense');
      await fetchAllPages(store.tiny_token, 'contas.pagar.pesquisa.php', 'pago', 'expense');
      // Fetch ALL pages of contas a receber (open + received)
      await fetchAllPages(store.tiny_token, 'contas.receber.pesquisa.php', 'aberto', 'income');
      await fetchAllPages(store.tiny_token, 'contas.receber.pesquisa.php', 'recebido', 'income');
    }

    // Upsert categories - check existing first to avoid duplicates
    let synced = 0;
    for (const [name, info] of allCategories) {
      const { data: existing } = await supabase
        .from('financial_categories')
        .select('id')
        .eq('tiny_category_id', name)
        .maybeSingle();
      
      if (existing) {
        synced++;
        continue;
      }

      const { error } = await supabase.from('financial_categories').insert({
        name,
        type: info.tipo,
        tiny_category_id: name,
        is_custom: false,
      });
      if (!error) synced++;
      else console.error('Insert error:', error);
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
