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
    const { store_id, product_id } = await req.json();
    if (!store_id || !product_id) throw new Error('store_id and product_id are required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: store } = await supabase
      .from('pos_stores')
      .select('tiny_token, tiny_deposit_name')
      .eq('id', store_id)
      .single();

    if (!store?.tiny_token) throw new Error('Store not found or token missing');

    const depositName = store.tiny_deposit_name || null;
    console.log(`[inventory-get-stock] store_id=${store_id}, product_id=${product_id}, deposit=${depositName}`);

    const resp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${store.tiny_token}&formato=json&id=${product_id}`,
    });

    const data = await resp.json();

    if (data.retorno?.status === 'Erro') {
      const err = data.retorno?.erros?.[0]?.erro || 'Error getting stock';
      return new Response(JSON.stringify({ success: false, error: err }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const produto = data.retorno?.produto;
    const depositos = produto?.depositos || [];
    let stock = parseFloat(produto?.saldo || '0');

    // Filter by specific deposit name if configured
    if (depositName && depositos.length > 0) {
      const matched = depositos.find((d: any) => {
        const dep = d?.deposito || d;
        const name = dep?.nome || dep?.descricao || '';
        return name.toLowerCase() === depositName.toLowerCase();
      });

      if (matched) {
        const dep = matched?.deposito || matched;
        stock = parseFloat(dep?.saldo || '0');
        console.log(`[inventory-get-stock] Matched deposit '${depositName}' → stock=${stock}`);
      } else {
        console.warn(`[inventory-get-stock] Deposit '${depositName}' NOT found in ${depositos.length} deposits. Using total saldo=${stock}`);
        console.log(`[inventory-get-stock] Available deposits:`, JSON.stringify(depositos));
      }
    } else if (depositos.length === 1) {
      const dep = depositos[0]?.deposito || depositos[0];
      stock = parseFloat(dep?.saldo || produto?.saldo || '0');
    }

    return new Response(JSON.stringify({
      success: true,
      stock,
      reserved: parseFloat(produto?.saldoReservado || '0'),
      deposits: depositos,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
