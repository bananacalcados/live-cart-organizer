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
    const { store_id, search_term } = await req.json();
    if (!store_id) throw new Error('store_id is required');
    if (!search_term || search_term.trim().length < 3) throw new Error('search_term must be at least 3 characters');

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

    const token = store.tiny_token;
    const term = search_term.trim();

    // Search Tiny orders by client name (pesquisa field searches across order data)
    const results: any[] = [];

    const searchTiny = async (pesquisa: string) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const resp = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&pesquisa=${encodeURIComponent(pesquisa)}&sort=DESC`,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const text = await resp.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          console.error('Tiny returned non-JSON:', text.substring(0, 200));
          return [];
        }

        if (data.retorno?.status === 'OK' && data.retorno?.pedidos) {
          return data.retorno.pedidos.map((p: any) => p.pedido).filter(Boolean);
        }
        return [];
      } catch (e) {
        console.error('Tiny search error:', e);
        return [];
      }
    };

    const tinyOrders = await searchTiny(term);

    // Map Tiny orders to a simplified format
    const mapped = tinyOrders.slice(0, 20).map((order: any) => ({
      tiny_order_id: String(order.id || ''),
      tiny_order_number: String(order.numero || ''),
      date: order.data_pedido || null,
      customer_name: order.nome || null,
      total: parseFloat(order.valor || '0'),
      status: order.situacao || null,
      items_summary: order.descricao_situacao || order.situacao || '',
    }));

    return new Response(JSON.stringify({ success: true, orders: mapped }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message, orders: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
