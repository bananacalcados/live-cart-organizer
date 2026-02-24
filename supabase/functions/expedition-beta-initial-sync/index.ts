import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TINY_V3_BASE = 'https://api.tiny.com.br/public-api/v3';

async function getTinyV3Token(supabase: any): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'tiny_app_token')
    .single();

  if (!data?.value?.access_token) return null;

  const tokenData = data.value as any;

  // Check if token needs refresh (expires_in is typically 300s = 5min)
  const connectedAt = new Date(tokenData.connected_at || tokenData.refreshed_at || 0).getTime();
  const expiresIn = (tokenData.expires_in || 300) * 1000;
  const now = Date.now();

  if (now - connectedAt > expiresIn - 30000) {
    // Token expired or about to expire, refresh it
    console.log('Tiny v3 token expired, refreshing...');
    try {
      const refreshRes = await fetch('https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
          client_id: Deno.env.get('TINY_APP_CLIENT_ID')!,
          client_secret: Deno.env.get('TINY_APP_CLIENT_SECRET')!,
        }).toString(),
      });

      if (!refreshRes.ok) {
        console.error('Token refresh failed:', await refreshRes.text());
        return null;
      }

      const newTokens = await refreshRes.json();
      await supabase.from('app_settings').upsert({
        key: 'tiny_app_token',
        value: {
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token || tokenData.refresh_token,
          id_token: newTokens.id_token,
          expires_in: newTokens.expires_in,
          token_type: newTokens.token_type,
          refreshed_at: new Date().toISOString(),
          connected_at: tokenData.connected_at,
        },
      }, { onConflict: 'key' });

      console.log('Tiny v3 token refreshed successfully');
      return newTokens.access_token;
    } catch (e) {
      console.error('Token refresh error:', e);
      return null;
    }
  }

  return tokenData.access_token;
}

async function tinyV3Get(token: string, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${TINY_V3_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!resp.ok) {
    const errText = await resp.text();
    // Tiny often returns 200 with error in body, but if status is not 200:
    throw new Error(`Tiny v3 ${path} failed (${resp.status}): ${errText.substring(0, 300)}`);
  }
  return resp.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = await getTinyV3Token(supabase);
    if (!token) {
      throw new Error("Não foi possível obter o token de acesso do Tiny (OAuth). Verifique a conexão na área administrativa.");
    }

    console.log("Fetching orders from Tiny V3...");

    // Tiny V3 API expects situacao as integer:
    // We'll fetch all orders without situacao filter and skip canceled/shipped ones locally
    // Or use known integer codes. Common Tiny V3 situacao integers:
    // Let's fetch without filter and handle locally
    
    let synced = 0;
    let skipped = 0;
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      console.log(`Fetching page ${page}...`);
      const data = await tinyV3Get(token, '/pedidos', { 
        pagina: String(page),
        limite: '100'
      });
        
      const orders = data.itens || data.items || [];
      if (orders.length === 0) {
        hasMore = false;
        break;
      }

      // Filter locally: skip canceled, shipped, delivered orders
      const skipStatuses = ['cancelado', 'cancelada', 'enviado', 'entregue', 'nao_entregue'];
      
      for (const item of orders) {
        try {
          const situacao = (item.situacao || item.descricaoSituacao || '').toString().toLowerCase();
          if (skipStatuses.some(s => situacao.includes(s))) {
            continue; // Skip non-expedition statuses
          }

          const tinyId = String(item.id);
          const shopifyId = item.numero_ecommerce ? String(item.numero_ecommerce) : null;
          
          // Check existence
          let existing = await supabase
            .from("expedition_beta_orders")
            .select("id")
            .eq("shopify_order_id", shopifyId || `tiny-${tinyId}`)
            .maybeSingle();

          if (!existing.data) {
            existing = await supabase
              .from("expedition_beta_orders")
              .select("id")
              .eq("shopify_order_id", `tiny-${tinyId}`)
              .maybeSingle();
          }

          if (existing.data) {
            skipped++;
            continue;
          }

          // Fetch full details
          let order: any;
          try {
            const details = await tinyV3Get(token, `/pedidos/${tinyId}`);
            order = details;
          } catch (detailErr) {
            console.error(`Error fetching details for ${tinyId}:`, detailErr);
            // Use list data as fallback
            order = item;
          }

          const finalShopifyId = order.numero_ecommerce ? String(order.numero_ecommerce) : `tiny-${tinyId}`;
          const customerName = order.cliente?.nome || order.nome || item.nome || "Cliente Tiny";
          
          const { data: inserted, error: insertError } = await supabase
            .from("expedition_beta_orders")
            .insert({
              shopify_order_id: finalShopifyId,
              shopify_order_name: order.numero_ecommerce ? `#${order.numero_ecommerce}` : `T-${order.numero || item.numero}`,
              shopify_order_number: order.numero_ecommerce || order.numero || item.numero,
              shopify_created_at: order.data_pedido ? new Date(order.data_pedido.split('/').reverse().join('-')).toISOString() : new Date().toISOString(),
              customer_name: customerName,
              customer_email: order.cliente?.email || null,
              customer_phone: order.cliente?.fone || order.cliente?.celular || null,
              customer_cpf: order.cliente?.cpf_cnpj || null,
              shipping_address: order.cliente ? {
                address1: order.cliente.endereco,
                address2: order.cliente.complemento,
                city: order.cliente.cidade,
                province: order.cliente.uf,
                zip: order.cliente.cep,
                country: 'Brazil',
                name: customerName,
                phone: order.cliente.fone || order.cliente.celular
              } : null,
              financial_status: 'paid',
              fulfillment_status: 'unfulfilled',
              expedition_status: 'approved',
              subtotal_price: parseFloat(order.totalProdutos || order.valor_itens || 0),
              total_price: parseFloat(order.totalPedido || order.valor_total || 0),
              total_discount: parseFloat(order.desconto || order.valor_desconto || 0),
              total_shipping: parseFloat(order.frete || order.valor_frete || 0),
              total_weight_grams: 0,
              has_gift: (order.obs || order.observacoes || '').toLowerCase().includes("brinde"),
              notes: order.obs || order.observacoes || null
            })
            .select()
            .single();

          if (insertError) {
            console.error(`Error inserting order ${tinyId}:`, insertError);
            continue;
          }

          // Insert Items
          const rawItems = order.itens || [];
          if (Array.isArray(rawItems) && rawItems.length > 0) {
            const itemsToInsert = rawItems.map((li: any) => {
              const i = li.item || li;
              return {
                expedition_order_id: inserted.id,
                product_name: i.descricao || i.nome || 'Produto',
                variant_name: null,
                sku: i.codigo,
                quantity: parseFloat(i.quantidade || 1),
                unit_price: parseFloat(i.valor_unitario || i.valorUnitario || 0),
                weight_grams: 0
              };
            });
            await supabase.from("expedition_beta_order_items").insert(itemsToInsert);
          }
          
          synced++;
        } catch (err) {
          console.error(`Error processing order ${item.id}:`, err);
        }
      }

      page++;
      if (page > 10) hasMore = false; 
    }

    console.log(`Tiny Sync complete: ${synced} synced, ${skipped} skipped`);

    return new Response(JSON.stringify({ success: true, synced, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Sync error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});