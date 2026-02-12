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
        let page = 1;
        let hasMore = true;

        while (hasMore && Date.now() - functionStart < TIME_LIMIT_MS) {
          const params: Record<string, string> = {
            token,
            formato: 'json',
            pagina: String(page),
          };

          // Filter by situacao if provided (aberto, pago, parcial, cancelado)
          if (situacao) {
            params.situacao = situacao;
          }

          const resp = await fetch('https://api.tiny.com.br/api2/contas.pagar.pesquisa.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params).toString(),
          });

          const data = await resp.json();

          if (data.retorno?.status === 'Erro') {
            console.log(`Tiny AP search error page ${page}:`, data.retorno?.erros);
            hasMore = false;
            break;
          }

          const totalPages = parseInt(data.retorno?.numero_paginas || '1');
          const contas = data.retorno?.contas || [];

          if (contas.length === 0) {
            hasMore = false;
            break;
          }

          // For each conta, get full details
          const rows: any[] = [];
          for (const item of contas) {
            if (Date.now() - functionStart > TIME_LIMIT_MS) break;
            const conta = item.conta;

            try {
              // Rate limit: ~30 req/min
              await new Promise(r => setTimeout(r, 2000));

              const detailResp = await fetch('https://api.tiny.com.br/api2/conta.pagar.obter.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `token=${token}&formato=json&id=${conta.id}`,
              });
              const detailData = await detailResp.json();
              const full = detailData.retorno?.conta;

              if (full) {
                rows.push({
                  store_id: store.id,
                  tiny_conta_id: String(full.id || conta.id),
                  nome_fornecedor: full.nome_cliente || full.cliente?.nome || conta.nome_cliente || null,
                  numero_doc: full.numero_doc || conta.numero_doc || null,
                  data_vencimento: parseDate(full.data_vencimento || conta.data_vencimento),
                  data_emissao: parseDate(full.data_emissao || conta.data_emissao),
                  data_pagamento: parseDate(full.data_pagamento),
                  valor: parseFloat(full.valor || conta.valor || '0'),
                  valor_pago: parseFloat(full.valor_pago || '0'),
                  saldo: parseFloat(full.saldo || conta.saldo || '0'),
                  situacao: full.situacao || conta.situacao || 'aberto',
                  observacoes: full.obs || null,
                  historico: full.historico || null,
                  categoria: full.categoria || null,
                  competencia: full.competencia || null,
                  nro_banco: full.nro_banco || null,
                  raw_data: full,
                  synced_at: new Date().toISOString(),
                });
              }
            } catch (e) {
              console.error(`Error fetching AP detail ${conta.id}:`, e);
              // Insert basic data from search result
              rows.push({
                store_id: store.id,
                tiny_conta_id: String(conta.id),
                nome_fornecedor: conta.nome_cliente || null,
                numero_doc: conta.numero_doc || null,
                data_vencimento: parseDate(conta.data_vencimento),
                data_emissao: parseDate(conta.data_emissao),
                valor: parseFloat(conta.valor || '0'),
                saldo: parseFloat(conta.saldo || '0'),
                situacao: conta.situacao || 'aberto',
                synced_at: new Date().toISOString(),
              });
            }
          }

          if (rows.length > 0) {
            await supabase.from('tiny_accounts_payable')
              .upsert(rows, { onConflict: 'store_id,tiny_conta_id' });
          }
          totalSynced += rows.length;

          page++;
          if (page > totalPages) hasMore = false;

          // Small delay between pages
          await new Promise(r => setTimeout(r, 500));
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
