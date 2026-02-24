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

  const connectedAt = new Date(tokenData.connected_at || tokenData.refreshed_at || 0).getTime();
  const expiresIn = (tokenData.expires_in || 300) * 1000;

  if (Date.now() - connectedAt > expiresIn - 30000) {
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
    throw new Error(`Tiny v3 ${path} failed (${resp.status}): ${errText.substring(0, 300)}`);
  }
  return resp.json();
}

function extractItems(order: any): any[] {
  const candidates = [order.itens, order.items, order.produtos];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return [];
}

// === PASS 1: Import approved orders (situacao=3) ===
async function passApproved(token: string, supabase: any, startTime: number) {
  let synced = 0, skipped = 0, page = 1, hasMore = true;

  while (hasMore) {
    if (Date.now() - startTime > 40000) { console.log('Pass1 timeout'); break; }

    console.log(`[Pass1-Approved] page ${page}`);
    const data = await tinyV3Get(token, '/pedidos', { pagina: String(page), limite: '100', situacao: '3' });
    const orders = data.itens || data.items || [];
    if (orders.length === 0) { hasMore = false; break; }

    for (const item of orders) {
      try {
        const tinyId = String(item.id);
        const { data: existing } = await supabase
          .from("expedition_beta_orders")
          .select("id, expedition_status, tracking_code")
          .eq("tiny_order_id", tinyId)
          .maybeSingle();

        const ecomNum = item.ecommerce?.numeroPedidoEcommerce || '';

        // Fetch detail for items
        let order: any;
        let detailFailed = false;
        try {
          await new Promise(r => setTimeout(r, 350));
          order = await tinyV3Get(token, `/pedidos/${tinyId}`);
        } catch (fetchErr: any) {
          console.error(`Detail fetch failed for ${tinyId}: ${fetchErr.message}`);
          if (!existing) { console.log(`Skipping new order ${tinyId} - no detail`); continue; }
          order = item;
          detailFailed = true;
        }

        // If detail shows dispatched/invoiced, update existing and skip
        const detailSituacao = order.situacao ?? item.situacao;
        if ([5, 6].includes(detailSituacao)) {
          if (existing && existing.expedition_status !== 'dispatched') {
            const trackingCode = order.codigoRastreamento || order.codigoRastreio || null;
            await supabase.from('expedition_beta_orders').update({
              expedition_status: 'dispatched',
              tracking_code: trackingCode || existing.tracking_code,
            }).eq('id', existing.id);
            synced++;
          }
          skipped++;
          continue;
        }

        if (existing) {
          // Backfill items if needed
          if (!detailFailed) {
            const { count: itemCount } = await supabase
              .from('expedition_beta_order_items')
              .select('id', { count: 'exact', head: true })
              .eq('expedition_order_id', existing.id);

            if (itemCount === 0) {
              const rawItems = extractItems(order);
              if (rawItems.length > 0) {
                const itemsToInsert = rawItems.map((li: any) => {
                  const prod = li.produto || li;
                  return {
                    expedition_order_id: existing.id,
                    product_name: prod.descricao || prod.nome || prod.description || 'Produto',
                    variant_name: null,
                    sku: prod.sku || prod.codigo || null,
                    quantity: parseFloat(li.quantidade || li.quantity || 1),
                    unit_price: parseFloat(li.valorUnitario || li.valor || 0),
                    weight_grams: 0,
                  };
                });
                await supabase.from('expedition_beta_order_items').insert(itemsToInsert);
                console.log(`Backfilled ${itemsToInsert.length} items for ${tinyId}`);
                synced++;
              }
            }
          }
          skipped++;
          continue;
        }

        // Insert new approved order
        const orderNum = String(order.numeroPedido || item.numeroPedido || '');
        const ecom = order.ecommerce?.numeroPedidoEcommerce || ecomNum;
        const finalShopifyId = ecom ? String(ecom) : `tiny-${tinyId}`;
        const cliente = order.cliente || {};
        const endereco = cliente.endereco || {};
        const customerName = cliente.nome || cliente.fantasia || "Cliente Tiny";

        const { data: inserted, error: insertError } = await supabase
          .from("expedition_beta_orders")
          .insert({
            shopify_order_id: finalShopifyId,
            shopify_order_name: ecom ? `#${ecom}` : `T-${orderNum}`,
            shopify_order_number: ecom || orderNum,
            shopify_created_at: order.data || order.dataCriacao || item.dataCriacao || new Date().toISOString(),
            customer_name: customerName,
            customer_email: cliente.email || null,
            customer_phone: cliente.telefone || cliente.celular || null,
            customer_cpf: cliente.cpfCnpj || null,
            shipping_address: endereco.endereco ? {
              address1: endereco.endereco || '', address2: endereco.complemento || '',
              city: endereco.cidade || '', province: endereco.uf || '', zip: endereco.cep || '',
              country: 'Brazil', name: customerName, number: endereco.numero || '',
              neighborhood: endereco.bairro || '', phone: cliente.telefone || cliente.celular || ''
            } : (order.enderecoEntrega || null),
            financial_status: 'paid',
            fulfillment_status: 'unfulfilled',
            expedition_status: 'approved',
            subtotal_price: parseFloat(order.valorTotalProdutos || item.valor || 0),
            total_price: parseFloat(order.valorTotalPedido || item.valor || 0),
            total_discount: parseFloat(order.valorDesconto || 0),
            total_shipping: parseFloat(order.valorFrete || 0),
            total_weight_grams: 0,
            has_gift: (order.observacoes || '').toLowerCase().includes("brinde"),
            notes: order.observacoes || null,
            tiny_order_id: tinyId,
            tiny_order_number: orderNum
          })
          .select().single();

        if (insertError) { console.error(`Insert error ${tinyId}:`, insertError.message); continue; }

        const rawItems = extractItems(order);
        if (rawItems.length > 0 && inserted) {
          const itemsToInsert = rawItems.map((li: any) => {
            const prod = li.produto || li;
            return {
              expedition_order_id: inserted.id,
              product_name: prod.descricao || prod.nome || prod.description || 'Produto',
              variant_name: null,
              sku: prod.sku || prod.codigo || null,
              quantity: parseFloat(li.quantidade || li.quantity || 1),
              unit_price: parseFloat(li.valorUnitario || li.valor || 0),
              weight_grams: 0
            };
          });
          await supabase.from("expedition_beta_order_items").insert(itemsToInsert);
        }
        synced++;
      } catch (err: any) {
        console.error(`Error processing ${item.id}:`, err.message);
      }
    }

    page++;
    if (page > 10) hasMore = false;
  }

  return { synced, skipped };
}

// === PASS 2: Update dispatched orders (situacao=5,6) ===
async function passDispatched(token: string, supabase: any, startTime: number) {
  let updated = 0;

  for (const sit of ['5', '6']) {
    let page = 1, hasMore = true;
    while (hasMore) {
      if (Date.now() - startTime > 50000) { console.log('Pass2 timeout'); return updated; }

      console.log(`[Pass2-Dispatched] situacao=${sit} page ${page}`);
      const data = await tinyV3Get(token, '/pedidos', { pagina: String(page), limite: '100', situacao: sit });
      const orders = data.itens || data.items || [];
      if (orders.length === 0) { hasMore = false; break; }

      for (const item of orders) {
        const tinyId = String(item.id);
        const { data: existing } = await supabase
          .from("expedition_beta_orders")
          .select("id, expedition_status, tracking_code")
          .eq("tiny_order_id", tinyId)
          .maybeSingle();

        if (existing && existing.expedition_status !== 'dispatched' && existing.expedition_status !== 'cancelled') {
          // Try to get tracking code
          let trackingCode = null;
          try {
            await new Promise(r => setTimeout(r, 350));
            const detail = await tinyV3Get(token, `/pedidos/${tinyId}`);
            trackingCode = detail.codigoRastreamento || detail.codigoRastreio || null;
          } catch (_) { /* skip detail */ }

          await supabase.from('expedition_beta_orders').update({
            expedition_status: 'dispatched',
            tracking_code: trackingCode || existing.tracking_code,
          }).eq('id', existing.id);
          updated++;
          console.log(`Marked ${tinyId} as dispatched`);
        } else if (existing && !existing.tracking_code) {
          // Just update tracking if missing
          try {
            await new Promise(r => setTimeout(r, 350));
            const detail = await tinyV3Get(token, `/pedidos/${tinyId}`);
            const tc = detail.codigoRastreamento || detail.codigoRastreio || null;
            if (tc) {
              await supabase.from('expedition_beta_orders').update({ tracking_code: tc }).eq('id', existing.id);
            }
          } catch (_) { /* skip */ }
        }
      }

      page++;
      if (page > 5) hasMore = false;
    }
  }

  return updated;
}

// === PASS 3: Update cancelled orders (situacao=9) ===
async function passCancelled(token: string, supabase: any, startTime: number) {
  let updated = 0;
  let page = 1, hasMore = true;

  while (hasMore) {
    if (Date.now() - startTime > 55000) { console.log('Pass3 timeout'); return updated; }

    console.log(`[Pass3-Cancelled] page ${page}`);
    const data = await tinyV3Get(token, '/pedidos', { pagina: String(page), limite: '100', situacao: '9' });
    const orders = data.itens || data.items || [];
    if (orders.length === 0) { hasMore = false; break; }

    for (const item of orders) {
      const tinyId = String(item.id);
      const { data: existing } = await supabase
        .from("expedition_beta_orders")
        .select("id, expedition_status")
        .eq("tiny_order_id", tinyId)
        .maybeSingle();

      if (existing && existing.expedition_status !== 'cancelled') {
        await supabase.from('expedition_beta_orders').update({
          expedition_status: 'cancelled',
        }).eq('id', existing.id);
        updated++;
        console.log(`Marked ${tinyId} as cancelled`);
      }
    }

    page++;
    if (page > 5) hasMore = false;
  }

  return updated;
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
    if (!token) throw new Error("Token OAuth do Tiny indisponível.");

    const startTime = Date.now();

    console.log("=== PASS 1: Approved orders ===");
    const { synced, skipped } = await passApproved(token, supabase, startTime);

    console.log("=== PASS 2: Dispatched orders ===");
    const dispatched = await passDispatched(token, supabase, startTime);

    console.log("=== PASS 3: Cancelled orders ===");
    const cancelled = await passCancelled(token, supabase, startTime);

    console.log(`Sync complete: ${synced} synced, ${skipped} skipped, ${dispatched} dispatched, ${cancelled} cancelled`);

    return new Response(JSON.stringify({ success: true, synced, skipped, dispatched, cancelled }), {
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
