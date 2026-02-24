import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface StockItem {
  tiny_id: number;
  product_name: string;
  quantity: number;
  direction: "in" | "out";
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, items } = await req.json() as { store_id: string; items: StockItem[] };

    if (!store_id) throw new Error('store_id is required');
    if (!items?.length) throw new Error('items array is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: store, error: storeError } = await supabase
      .from('pos_stores')
      .select('tiny_token, tiny_deposit_name')
      .eq('id', store_id)
      .single();

    if (storeError || !store?.tiny_token) throw new Error('Store not found or token not configured');

    const token = store.tiny_token;
    const depositName = store.tiny_deposit_name || '';
    const results: { product_name: string; success: boolean; error?: string; currentStock?: number; newStock?: number }[] = [];

    for (const item of items) {
      try {
        // Get current stock from Tiny for the specific deposit
        const stockResp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&id=${item.tiny_id}`,
        });
        const stockText = await stockResp.text();
        console.log(`Stock response for ${item.product_name} (${item.tiny_id}):`, stockText.substring(0, 500));
        
        let stockData: any;
        try { stockData = JSON.parse(stockText); } catch { 
          results.push({ product_name: item.product_name, success: false, error: 'Failed to parse stock response' });
          continue;
        }

        // Parse stock for specific deposit
        let currentStock = 0;
        if (depositName) {
          const depositos = stockData.retorno?.produto?.depositos || [];
          for (const dep of depositos) {
            const d = dep.deposito || dep;
            if (d.nome === depositName) {
              currentStock = parseFloat(d.saldo || '0');
              break;
            }
          }
          console.log(`Deposit "${depositName}" current stock for ${item.product_name}: ${currentStock}`);
        } else {
          currentStock = parseFloat(stockData.retorno?.produto?.saldo || '0');
          console.log(`Global current stock for ${item.product_name}: ${currentStock}`);
        }

        // Calculate new stock (absolute final quantity for Balanco)
        const newStock = item.direction === 'in'
          ? currentStock + item.quantity
          : Math.max(0, currentStock - item.quantity);

        console.log(`Calculating: ${currentStock} ${item.direction === 'in' ? '+' : '-'} ${item.quantity} = ${newStock}`);

        // Update stock in Tiny using XML with tipo=B (Balanco) and deposit
        const obsText = item.direction === 'in'
          ? `Troca POS: devolucao +${item.quantity}`
          : `Troca POS: saida -${item.quantity}`;

        // Send estoque as JSON (Tiny API V2 supports both XML and JSON for this parameter)
        // Tiny API V2 JSON format - deposit must use 'nome_deposito' key
        const estoquePayload: any = {
          idProduto: Number(item.tiny_id),
          tipo: 'B',
          quantidade: String(newStock),
          observacoes: obsText,
        };
        if (depositName) {
          estoquePayload.nome_deposito = depositName;
        }
        const estoqueJson = JSON.stringify({ estoque: estoquePayload });

        console.log(`Sending stock update JSON:`, estoqueJson);

        const formBody = new URLSearchParams();
        formBody.set('token', token);
        formBody.set('formato', 'json');
        formBody.set('estoque', estoqueJson);

        const updateResp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody.toString(),
        });
        const updateText = await updateResp.text();
        console.log(`Update response for ${item.product_name}:`, updateText.substring(0, 500));
        
        let updateData: any;
        try { updateData = JSON.parse(updateText); } catch {
          results.push({ product_name: item.product_name, success: false, error: 'Failed to parse update response: ' + updateText.substring(0, 100) });
          continue;
        }

        if (updateData.retorno?.status === 'Erro') {
          const nestedError = updateData.retorno?.registros?.registro?.erros?.[0]?.erro;
          const topError = updateData.retorno?.erros?.[0]?.erro;
          const errorMsg = nestedError || topError || JSON.stringify(updateData.retorno) || 'Unknown error';
          results.push({ product_name: item.product_name, success: false, error: errorMsg, currentStock, newStock });
        } else {
          results.push({ product_name: item.product_name, success: true, currentStock, newStock });
          console.log(`Stock adjusted [${depositName || 'global'}]: ${item.product_name} (${item.tiny_id}) ${currentStock} -> ${newStock} (${item.direction})`);
        }

        // Rate limit: wait 2s between Tiny API calls
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.error(`Error adjusting stock for ${item.product_name}:`, e);
        results.push({ product_name: item.product_name, success: false, error: e.message });
      }
    }

    const allOk = results.every(r => r.success);
    return new Response(JSON.stringify({ success: allOk, results }), {
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
