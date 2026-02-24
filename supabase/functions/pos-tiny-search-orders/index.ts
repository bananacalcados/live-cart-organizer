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
    const { store_id, search_term, mode, tiny_order_id } = await req.json();
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

    const token = store.tiny_token;

    // MODE: detail - fetch full order details
    if (mode === 'detail' && tiny_order_id) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch('https://api.tiny.com.br/api2/pedido.obter.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${token}&formato=json&id=${tiny_order_id}`,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await resp.text();
      let data: any;
      try { data = JSON.parse(text); } catch {
        return new Response(JSON.stringify({ success: false, error: 'Invalid response from Tiny' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (data.retorno?.status !== 'OK' || !data.retorno?.pedido) {
        return new Response(JSON.stringify({ success: false, error: data.retorno?.erros?.[0]?.erro || 'Order not found' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const pedido = data.retorno.pedido;
      const cliente = pedido.cliente || {};
      const itens = (pedido.itens || []).map((i: any) => {
        const item = i.item || i;
        return {
          product_name: item.descricao || '',
          sku: item.codigo || '',
          quantity: parseFloat(item.quantidade || '1'),
          unit_price: parseFloat(item.valor_unitario || '0'),
        };
      });

      const detail = {
        tiny_order_id: String(pedido.id || ''),
        tiny_order_number: String(pedido.numero || ''),
        date: pedido.data_pedido || null,
        status: pedido.situacao || null,
        total: parseFloat(pedido.valor || '0'),
        discount: parseFloat(pedido.desconto || '0'),
        shipping: parseFloat(pedido.valor_frete || '0'),
        payment_method: pedido.forma_pagamento || null,
        obs: pedido.obs || null,
        obs_interna: pedido.obs_interna || null,
        customer: {
          name: cliente.nome || null,
          cpf: cliente.cpf_cnpj || null,
          email: cliente.email || null,
          phone: cliente.fone || cliente.celular || null,
          address: cliente.endereco || null,
          address_number: cliente.numero || null,
          neighborhood: cliente.bairro || null,
          city: cliente.cidade || null,
          state: cliente.uf || null,
          cep: cliente.cep || null,
        },
        items: itens,
      };

      return new Response(JSON.stringify({ success: true, detail }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // MODE: search (default)
    if (!search_term || search_term.trim().length < 3) throw new Error('search_term must be at least 3 characters');

    const term = search_term.trim();

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
