import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TINY_V2_BASE = 'https://api.tiny.com.br/api2';

async function tinyV2Post(token: string, endpoint: string, params: Record<string, string>, maxRetries = 3): Promise<any> {
  const url = `${TINY_V2_BASE}/${endpoint}`;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const body = new URLSearchParams({ token, formato: 'json', ...params });
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (resp.status === 429) {
      if (attempt < maxRetries) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.log(`429 on ${endpoint}, retry ${attempt + 1} in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
    }
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Tiny v2 ${endpoint} failed (${resp.status}): ${errText.substring(0, 300)}`);
    }
    const json = await resp.json();
    if (json.retorno?.status === 'Erro') {
      const errMsg = json.retorno?.erros?.[0]?.erro || JSON.stringify(json.retorno?.erros);
      // "página não existe" means we've gone past the last page - return empty
      if (typeof errMsg === 'string' && errMsg.toLowerCase().includes('gina')) {
        return { pedidos: [] };
      }
      throw new Error(`Tiny v2 ${endpoint} error: ${errMsg}`);
    }
    return json.retorno;
  }
}

function extractItemsV2(pedido: any): any[] {
  const itens = pedido.itens;
  if (!Array.isArray(itens)) return [];
  return itens.map((i: any) => i.item).filter(Boolean);
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

  const orderIds = Array.from(map.values()).map((v: any) => v.id);
  if (orderIds.length > 0) {
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

// === PASS 1: Import approved orders (situacao=Aprovado) ===
async function passApproved(token: string, supabase: any, existingMap: Map<string, any>, startTime: number) {
  let synced = 0, skipped = 0, page = 1, hasMore = true;

  while (hasMore) {
    if (Date.now() - startTime > 40000) { console.log('Pass1 timeout'); break; }

    console.log(`[Pass1-Approved] page ${page}`);
    const data = await tinyV2Post(token, 'pedidos.pesquisa.php', { situacao: 'Aprovado', pagina: String(page) });
    const pedidos = data.pedidos || [];
    if (pedidos.length === 0) { hasMore = false; break; }

    const needDetail: any[] = [];
    const existingNeedBackfill: any[] = [];

    for (const wrapper of pedidos) {
      const item = wrapper.pedido;
      if (!item) continue;
      const tinyId = String(item.id);
      const existing = existingMap.get(tinyId);

      if (existing) {
        if (!existing.has_items) {
          existingNeedBackfill.push({ item, existing });
        }
        skipped++;
      } else {
        needDetail.push(item);
      }
    }

    const allNeedingDetail = [
      ...needDetail.map(item => ({ item, existing: null, isNew: true })),
      ...existingNeedBackfill.map(({ item, existing }) => ({ item, existing, isNew: false })),
    ];

    for (const { item, existing, isNew } of allNeedingDetail) {
      if (Date.now() - startTime > 40000) break;
      const tinyId = String(item.id);

      let pedido: any;
      try {
        await new Promise(r => setTimeout(r, 300));
        const detail = await tinyV2Post(token, 'pedido.obter.php', { id: tinyId });
        pedido = detail.pedido;
        if (!pedido) { console.error(`No pedido in detail for ${tinyId}`); continue; }
      } catch (fetchErr: any) {
        console.error(`Detail fail ${tinyId}: ${fetchErr.message}`);
        continue;
      }

      // Check if detail shows dispatched/cancelled
      const situacao = pedido.situacao || '';
      if (['Enviado', 'Entregue'].includes(situacao)) {
        if (existing && existing.expedition_status !== 'dispatched') {
          await supabase.from('expedition_beta_orders').update({
            expedition_status: 'dispatched',
            tracking_code: pedido.codigo_rastreamento || existing.tracking_code,
          }).eq('id', existing.id);
          synced++;
        }
        continue;
      }

      if (!isNew && existing) {
        // Backfill items
        const rawItems = extractItemsV2(pedido);
        if (rawItems.length > 0) {
          const itemsToInsert = rawItems.map((prod: any) => ({
            expedition_order_id: existing.id,
            product_name: prod.descricao || prod.nome || 'Produto',
            variant_name: null,
            sku: prod.codigo || null,
            quantity: parseFloat(prod.quantidade || 1),
            unit_price: parseFloat(prod.valor_unitario || 0),
            weight_grams: 0,
          }));
          await supabase.from('expedition_beta_order_items').insert(itemsToInsert);
          console.log(`Backfilled ${itemsToInsert.length} items for ${tinyId}`);
          synced++;
        }
        continue;
      }

      // Insert new order
      const ecomNum = pedido.numero_ecommerce || '';
      const orderNum = String(pedido.numero || '');
      const finalShopifyId = ecomNum ? String(ecomNum) : `tiny-${tinyId}`;
      const cliente = pedido.cliente || {};
      const customerName = cliente.nome || cliente.fantasia || "Cliente Tiny";

      const { data: inserted, error: insertError } = await supabase
        .from("expedition_beta_orders")
        .insert({
          shopify_order_id: finalShopifyId,
          shopify_order_name: ecomNum ? `#${ecomNum}` : `T-${orderNum}`,
          shopify_order_number: ecomNum || orderNum,
          shopify_created_at: pedido.data_pedido || pedido.data_criacao || new Date().toISOString(),
          customer_name: customerName,
          customer_email: cliente.email || null,
          customer_phone: cliente.fone || cliente.celular || null,
          customer_cpf: cliente.cpf_cnpj || null,
          shipping_address: pedido.endereco_entrega ? {
            address1: pedido.endereco_entrega.endereco || '',
            address2: pedido.endereco_entrega.complemento || '',
            city: pedido.endereco_entrega.cidade || '',
            province: pedido.endereco_entrega.uf || '',
            zip: pedido.endereco_entrega.cep || '',
            country: 'Brazil',
            name: customerName,
            number: pedido.endereco_entrega.numero || '',
            neighborhood: pedido.endereco_entrega.bairro || '',
            phone: cliente.fone || cliente.celular || ''
          } : null,
          financial_status: 'paid',
          fulfillment_status: 'unfulfilled',
          expedition_status: 'approved',
          subtotal_price: parseFloat(pedido.totalProdutos || pedido.total_produtos || 0),
          total_price: parseFloat(pedido.totalPedido || pedido.total_pedido || 0),
          total_discount: parseFloat(pedido.desconto || 0),
          total_shipping: parseFloat(pedido.frete || 0),
          total_weight_grams: 0,
          has_gift: (pedido.obs || pedido.observacoes || '').toLowerCase().includes("brinde"),
          notes: pedido.obs || pedido.observacoes || null,
          tiny_order_id: tinyId,
          tiny_order_number: orderNum
        }).select().single();

      if (insertError) { console.error(`Insert error ${tinyId}:`, insertError.message); continue; }

      const rawItems = extractItemsV2(pedido);
      if (rawItems.length > 0 && inserted) {
        const itemsToInsert = rawItems.map((prod: any) => ({
          expedition_order_id: inserted.id,
          product_name: prod.descricao || prod.nome || 'Produto',
          variant_name: null,
          sku: prod.codigo || null,
          quantity: parseFloat(prod.quantidade || 1),
          unit_price: parseFloat(prod.valor_unitario || 0),
          weight_grams: 0
        }));
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

// === PASS 2: Update dispatched orders (Enviado/Entregue) ===
async function passDispatched(token: string, supabase: any, existingMap: Map<string, any>, startTime: number) {
  let updated = 0;

  for (const sit of ['Enviado', 'Entregue']) {
    let page = 1, hasMore = true;
    while (hasMore) {
      if (Date.now() - startTime > 50000) { console.log('Pass2 timeout'); return updated; }

      console.log(`[Pass2-Dispatched] sit=${sit} p${page}`);
      const data = await tinyV2Post(token, 'pedidos.pesquisa.php', { situacao: sit, pagina: String(page) });
      const pedidos = data.pedidos || [];
      if (pedidos.length === 0) { hasMore = false; break; }

      const updates: { id: string }[] = [];
      for (const wrapper of pedidos) {
        const item = wrapper.pedido;
        if (!item) continue;
        const tinyId = String(item.id);
        const existing = existingMap.get(tinyId);

        if (existing && existing.expedition_status !== 'dispatched' && existing.expedition_status !== 'cancelled') {
          updates.push({ id: existing.id });
          existing.expedition_status = 'dispatched';
        }
      }

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

// === PASS 3: Update cancelled orders (Cancelado) ===
async function passCancelled(token: string, supabase: any, existingMap: Map<string, any>, startTime: number) {
  let updated = 0;
  let page = 1, hasMore = true;

  while (hasMore) {
    if (Date.now() - startTime > 55000) { console.log('Pass3 timeout'); return updated; }

    console.log(`[Pass3-Cancelled] p${page}`);
    const data = await tinyV2Post(token, 'pedidos.pesquisa.php', { situacao: 'Cancelado', pagina: String(page) });
    const pedidos = data.pedidos || [];
    if (pedidos.length === 0) { hasMore = false; break; }

    const ids: string[] = [];
    for (const wrapper of pedidos) {
      const item = wrapper.pedido;
      if (!item) continue;
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

// === PASS 0: Cleanup - fetch approved from Tiny, delete locals not in that set ===
async function passCleanup(token: string, supabase: any, startTime: number, timeoutMs = 30000) {
  const tinyApprovedIds = new Set<string>();
  let page = 1, hasMore = true;

  while (hasMore) {
    if (Date.now() - startTime > timeoutMs) { console.log('Cleanup fetch timeout'); break; }
    try {
      const data = await tinyV2Post(token, 'pedidos.pesquisa.php', { situacao: 'Aprovado', pagina: String(page) });
      const pedidos = data.pedidos || [];
      if (pedidos.length === 0) { hasMore = false; break; }
      for (const wrapper of pedidos) {
        const item = wrapper.pedido;
        if (item) tinyApprovedIds.add(String(item.id));
      }
      console.log(`[Cleanup] Tiny approved page ${page}: ${pedidos.length} orders`);
      page++;
      if (page > 10 || pedidos.length < 20) hasMore = false;
    } catch (err: any) {
      console.error(`Cleanup fetch page ${page} error: ${err.message}`);
      hasMore = false;
    }
  }

  console.log(`[Cleanup] Total approved in Tiny: ${tinyApprovedIds.size}`);

  const { data: localApproved } = await supabase
    .from('expedition_beta_orders')
    .select('id, tiny_order_id')
    .eq('expedition_status', 'approved')
    .not('tiny_order_id', 'is', null);

  if (!localApproved || localApproved.length === 0) return 0;

  const toDelete = localApproved.filter((o: any) => !tinyApprovedIds.has(String(o.tiny_order_id)));

  if (toDelete.length === 0) {
    console.log(`[Cleanup] All ${localApproved.length} local approved orders match Tiny. Nothing to delete.`);
    return 0;
  }

  const deleteIds = toDelete.map((o: any) => o.id);
  const deleteTinyIds = toDelete.map((o: any) => o.tiny_order_id);
  console.log(`[Cleanup] Deleting ${toDelete.length} stale orders: ${deleteTinyIds.join(', ')}`);

  await supabase.from('expedition_beta_order_items').delete().in('expedition_order_id', deleteIds);
  await supabase.from('expedition_beta_orders').delete().in('id', deleteIds);

  console.log(`[Cleanup] Deleted ${toDelete.length} orders + their items`);
  return toDelete.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = Deno.env.get("TINY_ERP_TOKEN");
    if (!token) throw new Error("TINY_ERP_TOKEN não configurado.");

    const startTime = Date.now();

    console.log("Loading existing orders...");
    const existingMap = await loadExistingOrders(supabase);
    console.log(`Loaded ${existingMap.size} existing orders in ${Date.now() - startTime}ms`);

    console.log("=== PASS 0: Cleanup ===");
    const cleaned = await passCleanup(token, supabase, startTime, 30000);

    console.log("=== PASS 1: Approved ===");
    const { synced, skipped } = await passApproved(token, supabase, existingMap, startTime);

    console.log("=== PASS 2: Dispatched ===");
    const dispatched = await passDispatched(token, supabase, existingMap, startTime);

    console.log("=== PASS 3: Cancelled ===");
    const cancelled = await passCancelled(token, supabase, existingMap, startTime);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s: ${cleaned} cleaned, ${synced} synced, ${skipped} skipped, ${dispatched} dispatched, ${cancelled} cancelled`);

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
