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
      .select('tiny_token')
      .eq('id', store_id)
      .single();

    if (!store?.tiny_token) throw new Error('Store not found or token missing');

    console.log(`[inventory-get-stock] store_id=${store_id}, product_id=${product_id}, token_prefix=${store.tiny_token.substring(0,8)}`);

    const resp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${store.tiny_token}&formato=json&id=${product_id}`,
    });

    const data = await resp.json();
    // Log FULL response to diagnose multi-deposit issue
    console.log(`[inventory-get-stock] FULL response for product ${product_id}:`, JSON.stringify(data.retorno));

    if (data.retorno?.status === 'Erro') {
      const err = data.retorno?.erros?.[0]?.erro || 'Error getting stock';
      return new Response(JSON.stringify({ success: false, error: err }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const produto = data.retorno?.produto;

    // Check if there are multiple deposits — use deposit-specific stock if available
    const depositos = produto?.depositos || [];
    let stock = parseFloat(produto?.saldo || '0');

    if (depositos.length > 0) {
      console.log(`[inventory-get-stock] Found ${depositos.length} deposits:`, JSON.stringify(depositos));
      // If there's only 1 deposit or we can't distinguish, use the first one
      // The saldo field is the SUM of all deposits, which is wrong for multi-store
      if (depositos.length === 1) {
        stock = parseFloat(depositos[0]?.deposito?.saldo || depositos[0]?.saldo || produto?.saldo || '0');
      }
      // For now log everything so we can see the structure
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
