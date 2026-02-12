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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { account_ids, data_pagamento } = await req.json();

    if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
      throw new Error('account_ids is required');
    }

    const payDate = data_pagamento || new Date().toISOString().split('T')[0];
    // Format to dd/mm/yyyy for Tiny
    const [y, m, d] = payDate.split('-');
    const tinyDate = `${d}/${m}/${y}`;

    // Get the accounts with their store info
    const { data: accounts, error: fetchErr } = await supabase
      .from('tiny_accounts_payable')
      .select('id, tiny_conta_id, store_id, valor, saldo')
      .in('id', account_ids);

    if (fetchErr) throw fetchErr;
    if (!accounts || accounts.length === 0) throw new Error('No accounts found');

    // Get store tokens
    const storeIds = [...new Set(accounts.map(a => a.store_id))];
    const { data: storeData } = await supabase
      .from('pos_stores')
      .select('id, tiny_token')
      .in('id', storeIds);

    const tokenMap = new Map(storeData?.map(s => [s.id, s.tiny_token]) || []);

    const results: any[] = [];

    for (const account of accounts) {
      const token = tokenMap.get(account.store_id);
      if (!token) {
        results.push({ id: account.id, status: 'error', error: 'No token for store' });
        continue;
      }

      try {
        // Try to update in Tiny using conta.pagar.alterar.php
        const contaData = JSON.stringify({
          conta: {
            id: Number(account.tiny_conta_id),
            situacao: 'pago',
            data_pagamento: tinyDate,
            valor_pago: String(account.valor || account.saldo || 0),
          }
        });

        const resp = await fetch('https://api.tiny.com.br/api2/conta.pagar.alterar.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&conta=${encodeURIComponent(contaData)}`,
        });

        const data = await resp.json();
        console.log(`Tiny mark paid ${account.tiny_conta_id}:`, JSON.stringify(data));

        const tinySuccess = data.retorno?.status !== 'Erro';

        // Update local DB regardless
        await supabase.from('tiny_accounts_payable').update({
          situacao: 'pago',
          data_pagamento: payDate,
          valor_pago: account.valor || account.saldo || 0,
          saldo: 0,
          synced_at: new Date().toISOString(),
        }).eq('id', account.id);

        results.push({
          id: account.id,
          tiny_conta_id: account.tiny_conta_id,
          status: tinySuccess ? 'success' : 'local_only',
          tiny_response: tinySuccess ? 'ok' : data.retorno?.erros,
        });

        // Rate limit
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.error(`Error marking paid ${account.id}:`, e);
        // Still update locally
        await supabase.from('tiny_accounts_payable').update({
          situacao: 'pago',
          data_pagamento: payDate,
          valor_pago: account.valor || account.saldo || 0,
          saldo: 0,
          synced_at: new Date().toISOString(),
        }).eq('id', account.id);

        results.push({
          id: account.id,
          status: 'local_only',
          error: (e as Error).message,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
