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

async function tinyV3Get(token: string, path: string, params?: Record<string, string>, maxRetries = 3): Promise<any> {
  const url = new URL(`${TINY_V3_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (resp.status === 429) {
      if (attempt < maxRetries) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.log(`429 on ${path}, retry ${attempt + 1} in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
    }
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Tiny v3 ${path} failed (${resp.status}): ${errText.substring(0, 300)}`);
    }
    return resp.json();
  }
}

function extractItems(order: any): any[] {
  const candidates = [order.itens, order.items, order.produtos];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return [];
}

// Pre-load all existing tiny_order_ids to avoid per-order DB lookups
async function loadExistingOrders(supabase: any): Promise<Map<string, { id: string; expedition_status: string; tracking_code: string | null; has_items: boolean }>> {
  const map = new Map();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await supabase
      .from('expedition_beta_orders')
      .select('id, tiny_order_id, expedition_status, tracking_code')
      .not('tiny_order_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const row of data) {
      map.set(row.tiny_order_id, { id: row.id, expedition_status: row.expedition_status, tracking_code: row.tracking_code, has_items: false });
    }
    from += PAGE;
    if (data.length < PAGE) break;
  }

  // Batch check which orders have items
  const orderIds = Array.from(map.values()).map((v: any) => v.id);
  if (orderIds.length > 0) {
    // Get distinct expedition_order_ids that have items
    const { data: withItems } = await supabase
      .from('expedition_beta_order_items')
      .select('expedition_order_id')
      .in('expedition_order_id', orderIds);
    if (withItems) {
      const hasItemsSet = new Set(withItems.map((r: any) => r.expedition_order_id));
      for (const [key, val] of map.entries()) {
        (val as any).has_items = hasItemsSet.has(val.id);
      }
    }
  }

  return map;
}

// === PASS 1: Import approved orders (situacao=3) ===
async function passApproved(token: string, supabase: any, existingMap: Map<string, any>, startTime: number) {
  let synced = 0, skipped = 0, page = 1, hasMore = true;

  while (hasMore) {
    if (Date.now() - startTime > 40000) { console.log('Pass1 timeout'); break; }

    console.log(`[Pass1-Approved] page ${page}`);
    const data = await tinyV3Get(token, '/pedidos', { pagina: String(page), limite: '100', situacao: '3' });
    const orders = data.itens || data.items || [];
    if (orders.length === 0) { hasMore = false; break; }

    // Collect new orders that need detail fetch
    const needDetail: any[] = [];
    const existingNeedBackfill: any[] = [];

    for (const item of orders) {
      const tinyId = String(item.id);
      const existing = existingMap.get(tinyId);

      if (existing) {
        // Only need detail if missing items
        if (!existing.has_items) {
          existingNeedBackfill.push({ item, existing });
        }
        skipped++;
      } else {
        needDetail.push(item);
      }
    }

    // Fetch details only for orders that actually need it (new + backfill)
    const allNeedingDetail = [
      ...needDetail.map(item => ({ item, existing: null, isNew: true })),
      ...existingNeedBackfill.map(({ item, existing }) => ({ item, existing, isNew: false })),
    ];

    for (const { item, existing, isNew } of allNeedingDetail) {
      if (Date.now() - startTime > 40000) break;
      const tinyId = String(item.id);

      let order: any;
      try {
        await new Promise(r => setTimeout(r, 200));
        order = await tinyV3Get(token, `/pedidos/${tinyId}`);
      } catch (fetchErr: any) {
        console.error(`Detail fail ${tinyId}: ${fetchErr.message}`);
        if (isNew) continue; // Skip new orders without detail
        continue;
      }

      // Check if detail shows dispatched
      const detailSituacao = order.situacao ?? item.situacao;
      if ([5, 6].includes(detailSituacao)) {
        if (existing && existing.expedition_status !== 'dispatched') {
          await supabase.from('expedition_beta_orders').update({
            expedition_status: 'dispatched',
            tracking_code: order.codigoRastreamento || order.codigoRastreio || existing.tracking_code,
          }).eq('id', existing.id);
          synced++;
        }
        continue;
      }

      if (!isNew && existing) {
        // Backfill items
        const rawItems = extractItems(order);
        if (rawItems.length > 0) {
          const itemsToInsert = rawItems.map((li: any) => {
            const prod = li.produto || li;
            return {
              expedition_order_id: existing.id,
              product_name: prod.descricao || prod.nome || prod.description || 'Produto',
              variant_name: null, sku: prod.sku || prod.codigo || null,
              quantity: parseFloat(li.quantidade || li.quantity || 1),
              unit_price: parseFloat(li.valorUnitario || li.valor || 0),
              weight_grams: 0,
            };
          });
          await supabase.from('expedition_beta_order_items').insert(itemsToInsert);
          console.log(`Backfilled ${itemsToInsert.length} items for ${tinyId}`);
          synced++;
        }
        continue;
      }

      // Insert new order
      const ecomNum = item.ecommerce?.numeroPedidoEcommerce || '';
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
          financial_status: 'paid', fulfillment_status: 'unfulfilled',
          expedition_status: 'approved',
          subtotal_price: parseFloat(order.valorTotalProdutos || item.valor || 0),
          total_price: parseFloat(order.valorTotalPedido || item.valor || 0),
          total_discount: parseFloat(order.valorDesconto || 0),
          total_shipping: parseFloat(order.valorFrete || 0),
          total_weight_grams: 0,
          has_gift: (order.observacoes || '').toLowerCase().includes("brinde"),
          notes: order.observacoes || null,
          tiny_order_id: tinyId, tiny_order_number: orderNum
        }).select().single();

      if (insertError) { console.error(`Insert error ${tinyId}:`, insertError.message); continue; }

      const rawItems = extractItems(order);
      if (rawItems.length > 0 && inserted) {
        const itemsToInsert = rawItems.map((li: any) => {
          const prod = li.produto || li;
          return {
            expedition_order_id: inserted.id,
            product_name: prod.descricao || prod.nome || prod.description || 'Produto',
            variant_name: null, sku: prod.sku || prod.codigo || null,
            quantity: parseFloat(li.quantidade || li.quantity || 1),
            unit_price: parseFloat(li.valorUnitario || li.valor || 0),
            weight_grams: 0
          };
        });
        await supabase.from("expedition_beta_order_items").insert(itemsToInsert);
      }

      existingMap.set(tinyId, { id: inserted.id, expedition_status: 'approved', tracking_code: null, has_items: rawItems.length > 0 });
      synced++;
    }

    page++;
    if (page > 10) hasMore = false;
  }

  return { synced, skipped };
}

// === PASS 2: Update dispatched orders (situacao=5,6) - NO detail fetch needed ===
async function passDispatched(token: string, supabase: any, existingMap: Map<string, any>, startTime: number) {
  let updated = 0;

  for (const sit of ['5', '6']) {
    let page = 1, hasMore = true;
    while (hasMore) {
      if (Date.now() - startTime > 50000) { console.log('Pass2 timeout'); return updated; }

      console.log(`[Pass2-Dispatched] sit=${sit} p${page}`);
      const data = await tinyV3Get(token, '/pedidos', { pagina: String(page), limite: '100', situacao: sit });
      const orders = data.itens || data.items || [];
      if (orders.length === 0) { hasMore = false; break; }

      // Batch: collect updates
      const updates: { id: string; tracking_code?: string }[] = [];

      for (const item of orders) {
        const tinyId = String(item.id);
        const existing = existingMap.get(tinyId);

        if (existing && existing.expedition_status !== 'dispatched' && existing.expedition_status !== 'cancelled') {
          updates.push({ id: existing.id });
          existing.expedition_status = 'dispatched';
        }
      }

      // Batch update all at once
      if (updates.length > 0) {
        const ids = updates.map(u => u.id);
        await supabase.from('expedition_beta_orders')
          .update({ expedition_status: 'dispatched' })
          .in('id', ids);
        updated += updates.length;
        console.log(`Batch dispatched ${updates.length} orders`);
      }

      page++;
      if (page > 5) hasMore = false;
    }
  }

  return updated;
}

// === PASS 3: Update cancelled orders (situacao=9) - NO detail fetch ===
async function passCancelled(token: string, supabase: any, existingMap: Map<string, any>, startTime: number) {
  let updated = 0;
  let page = 1, hasMore = true;

  while (hasMore) {
    if (Date.now() - startTime > 55000) { console.log('Pass3 timeout'); return updated; }

    console.log(`[Pass3-Cancelled] p${page}`);
    const data = await tinyV3Get(token, '/pedidos', { pagina: String(page), limite: '100', situacao: '9' });
    const orders = data.itens || data.items || [];
    if (orders.length === 0) { hasMore = false; break; }

    const ids: string[] = [];
    for (const item of orders) {
      const tinyId = String(item.id);
      const existing = existingMap.get(tinyId);
      if (existing && existing.expedition_status !== 'cancelled') {
        ids.push(existing.id);
        existing.expedition_status = 'cancelled';
      }
    }

    if (ids.length > 0) {
      await supabase.from('expedition_beta_orders')
        .update({ expedition_status: 'cancelled' })
        .in('id', ids);
      updated += ids.length;
      console.log(`Batch cancelled ${ids.length} orders`);
    }

    page++;
    if (page > 5) hasMore = false;
  }

  return updated;
}

// === PASS 4: Cleanup - verify approved orders still approved in Tiny ===
async function passCleanup(token: string, supabase: any, startTime: number) {
  let fixed = 0;

  // Get all orders we have as 'approved'
  const { data: approvedOrders } = await supabase
    .from('expedition_beta_orders')
    .select('id, tiny_order_id')
    .eq('expedition_status', 'approved')
    .not('tiny_order_id', 'is', null);

  if (!approvedOrders || approvedOrders.length === 0) return 0;

  console.log(`[Pass4-Cleanup] Checking ${approvedOrders.length} approved orders`);

  for (const order of approvedOrders) {
    if (Date.now() - startTime > 55000) { console.log('Pass4 timeout'); break; }

    try {
      await new Promise(r => setTimeout(r, 300));
      const detail = await tinyV3Get(token, `/pedidos/${order.tiny_order_id}`);
      const sit = detail.situacao;

      if (sit === 9) {
        await supabase.from('expedition_beta_orders').update({ expedition_status: 'cancelled' }).eq('id', order.id);
        fixed++;
        console.log(`Cleanup: ${order.tiny_order_id} -> cancelled`);
      } else if ([5, 6].includes(sit)) {
        const tc = detail.codigoRastreamento || detail.codigoRastreio || null;
        await supabase.from('expedition_beta_orders').update({ 
          expedition_status: 'dispatched',
          ...(tc ? { tracking_code: tc } : {}),
        }).eq('id', order.id);
        fixed++;
        console.log(`Cleanup: ${order.tiny_order_id} -> dispatched`);
      } else if (sit === 7 || sit === 8) {
        await supabase.from('expedition_beta_orders').update({ expedition_status: 'dispatched' }).eq('id', order.id);
        fixed++;
        console.log(`Cleanup: ${order.tiny_order_id} -> dispatched (delivered/failed)`);
      }
      // sit === 0 or 3 = keep as approved
    } catch (err: any) {
      console.error(`Cleanup fail ${order.tiny_order_id}: ${err.message}`);
    }
  }

  return fixed;
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

    // Pre-load all existing orders in memory (avoids per-order DB queries)
    console.log("Loading existing orders...");
    const existingMap = await loadExistingOrders(supabase);
    console.log(`Loaded ${existingMap.size} existing orders in ${Date.now() - startTime}ms`);

    console.log("=== PASS 1: Approved ===");
    const { synced, skipped } = await passApproved(token, supabase, existingMap, startTime);

    console.log("=== PASS 2: Dispatched ===");
    const dispatched = await passDispatched(token, supabase, existingMap, startTime);

    console.log("=== PASS 3: Cancelled ===");
    const cancelled = await passCancelled(token, supabase, existingMap, startTime);

    console.log("=== PASS 4: Cleanup approved ===");
    const cleaned = await passCleanup(token, supabase, startTime);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s: ${synced} synced, ${skipped} skipped, ${dispatched} dispatched, ${cancelled} cancelled, ${cleaned} cleaned`);

    return new Response(JSON.stringify({ success: true, synced, skipped, dispatched, cancelled, cleaned, elapsed }), {
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
