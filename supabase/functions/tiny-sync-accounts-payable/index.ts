import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const TIME_LIMIT_MS = 50_000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const functionStart = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { store_id, situacao } = body;

    // Get stores to sync
    let stores: { id: string; name: string; tiny_token: string }[] = [];
    if (store_id) {
      const { data, error } = await supabase
        .from('pos_stores').select('id, name, tiny_token').eq('id', store_id).single();
      if (error || !data?.tiny_token) throw new Error('Store not found or missing token');
      stores = [data];
    } else {
      const { data } = await supabase
        .from('pos_stores').select('id, name, tiny_token')
        .not('tiny_token', 'is', null).eq('is_active', true);
      stores = data || [];
    }

    const results: any[] = [];

    for (const store of stores) {
      if (Date.now() - functionStart > TIME_LIMIT_MS) {
        results.push({ store_id: store.id, store_name: store.name, status: 'skipped' });
        continue;
      }

      // Create sync log
      const { data: logEntry } = await supabase
        .from('tiny_accounts_payable_sync_log')
        .insert({ store_id: store.id, status: 'running' })
        .select('id').single();
      const logId = logEntry?.id;

      try {
        const token = store.tiny_token;
        let totalSynced = 0;

        // Tiny requires at least one filter param — iterate over situações
        const situacoes = situacao ? [situacao] : ['aberto', 'parcial', 'pago', 'cancelado'];

        for (const sit of situacoes) {
          if (Date.now() - functionStart > TIME_LIMIT_MS) break;

          let page = 1;
          let hasMore = true;

          while (hasMore && Date.now() - functionStart < TIME_LIMIT_MS) {
            const params: Record<string, string> = {
              token,
              formato: 'json',
              pagina: String(page),
              situacao: sit,
            };

            const resp = await fetch('https://api.tiny.com.br/api2/contas.pagar.pesquisa.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams(params).toString(),
            });

            const data = await resp.json();

            if (data.retorno?.status === 'Erro') {
              console.log(`Tiny AP search error sit=${sit} page ${page}:`, data.retorno?.erros);
              hasMore = false;
              break;
            }

            const totalPages = parseInt(data.retorno?.numero_paginas || '1');
            const contas = data.retorno?.contas || [];

            if (contas.length === 0) {
              hasMore = false;
              break;
            }

            // Use search results directly (no individual detail calls to avoid timeout)
            const rows: any[] = [];
            for (const item of contas) {
              const conta = item.conta;
              rows.push({
                store_id: store.id,
                tiny_conta_id: String(conta.id),
                nome_fornecedor: conta.nome_cliente || null,
                numero_doc: conta.numero_doc || null,
                data_vencimento: parseDate(conta.data_vencimento),
                data_emissao: parseDate(conta.data_emissao),
                valor: parseFloat(conta.valor || '0'),
                saldo: parseFloat(conta.saldo || '0'),
                situacao: conta.situacao || sit,
                historico: conta.historico || null,
                synced_at: new Date().toISOString(),
              });
            }

            if (rows.length > 0) {
              await supabase.from('tiny_accounts_payable')
                .upsert(rows, { onConflict: 'store_id,tiny_conta_id' });
            }
            totalSynced += rows.length;

            page++;
            if (page > totalPages) hasMore = false;

            await new Promise(r => setTimeout(r, 500));
          }
        }

        // Enrich open accounts with categories (detail endpoint)
        if (Date.now() - functionStart < TIME_LIMIT_MS - 10000) {
          const { data: openAccounts } = await supabase
            .from('tiny_accounts_payable')
            .select('id, tiny_conta_id, categoria')
            .eq('store_id', store.id)
            .in('situacao', ['aberto', 'parcial'])
            .is('categoria', null)
            .limit(8); // Process up to 8 per run

          for (const acc of (openAccounts || [])) {
            if (Date.now() - functionStart > TIME_LIMIT_MS - 3000) break;
            try {
              await new Promise(r => setTimeout(r, 2100));
              const detailResp = await fetch('https://api.tiny.com.br/api2/conta.pagar.obter.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `token=${token}&formato=json&id=${acc.tiny_conta_id}`,
              });
              const detailData = await detailResp.json();
              const full = detailData.retorno?.conta;
              if (full) {
                await supabase.from('tiny_accounts_payable').update({
                  categoria: full.categoria || null,
                  historico: full.historico || null,
                  competencia: full.competencia || null,
                  observacoes: full.obs || null,
                }).eq('id', acc.id);
              }
            } catch (e) {
              console.error(`Detail enrich error ${acc.tiny_conta_id}:`, e);
            }
          }
        }

        // Mark complete
        if (logId) {
          await supabase.from('tiny_accounts_payable_sync_log').update({
            status: 'completed',
            total_synced: totalSynced,
            completed_at: new Date().toISOString(),
          }).eq('id', logId);
        }

        results.push({
          store_id: store.id,
          store_name: store.name,
          total_synced: totalSynced,
          status: 'completed',
        });
      } catch (e) {
        console.error(`AP sync error ${store.name}:`, e);
        if (logId) {
          await supabase.from('tiny_accounts_payable_sync_log').update({
            status: 'error',
            error_message: (e as Error).message,
            completed_at: new Date().toISOString(),
          }).eq('id', logId);
        }
        results.push({
          store_id: store.id,
          store_name: store.name,
          status: 'error',
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

/** Parse dd/MM/yyyy or yyyy-MM-dd to ISO date string, or null */
function parseDate(str?: string | null): string | null {
  if (!str) return null;
  // dd/MM/yyyy
  if (str.includes('/')) {
    const [d, m, y] = str.split('/').map(Number);
    if (y && m && d) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // Already yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
  return null;
}
