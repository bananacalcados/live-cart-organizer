import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TINY_V2_BASE = 'https://api.tiny.com.br/api2';

// Map Tiny situacao -> expedition_status
const TINY_STATUS_MAP: Record<string, string> = {
  'Em Aberto': 'pending',
  'Aprovado': 'approved',
  'Preparando Envio': 'preparing',
  'Faturado': 'invoiced',
  'Pronto para Envio': 'ready_to_ship',
  'Enviado': 'dispatched',
  'Entregue': 'delivered',
  'Não Entregue': 'not_delivered',
  'Cancelado': 'cancelled',
};

// Map Tiny situacao -> financial_status
const TINY_FINANCIAL_MAP: Record<string, string> = {
  'Em Aberto': 'pending',
  'Aprovado': 'paid',
  'Preparando Envio': 'paid',
  'Faturado': 'paid',
  'Pronto para Envio': 'paid',
  'Enviado': 'paid',
  'Entregue': 'paid',
  'Não Entregue': 'paid',
  'Cancelado': 'cancelled',
};

// All situações to sync (order matters for priority)
const TINY_SITUACOES = [
  'Aprovado',
  'Preparando Envio',
  'Faturado',
  'Pronto para Envio',
  'Enviado',
  'Entregue',
  'Não Entregue',
  'Cancelado',
];

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
      if (typeof errMsg === 'string' && errMsg.toLowerCase().includes('gina')) {
        return { pedidos: [] };
      }
      throw new Error(`Tiny v2 ${endpoint} error: ${errMsg}`);
    }
    return json.retorno;
  }
}

function brDateToISO(dateStr: string | undefined | null): string {
  if (!dateStr) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return new Date().toISOString();
}

function extractItemsV2(pedido: any): any[] {
  const itens = pedido.itens;
  if (!Array.isArray(itens)) return [];
  return itens.map((i: any) => i.item).filter(Boolean);
}

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
    // batch check in chunks of 500
    for (let i = 0; i < orderIds.length; i += 500) {
      const chunk = orderIds.slice(i, i + 500);
      const { data: withItems } = await supabase
        .from('expedition_beta_order_items')
        .select('expedition_order_id')
        .in('expedition_order_id', chunk);
      if (withItems) {
        const hasItemsSet = new Set(withItems.map((r: any) => r.expedition_order_id));
        for (const [key, val] of map.entries()) {
          if (hasItemsSet.has(val.id)) (val as any).has_items = true;
        }
      }
    }
  }

  return map;
}

// === Universal pass: import orders for a given Tiny situacao ===
async function passSituacao(
  token: string,
  supabase: any,
  existingMap: Map<string, any>,
  situacao: string,
  startTime: number,
  timeoutMs: number,
): Promise<{ synced: number; skipped: number; updated: number }> {
  let synced = 0, skipped = 0, updated = 0;
  let page = 1, hasMore = true;
  const expeditionStatus = TINY_STATUS_MAP[situacao] || 'approved';
  const financialStatus = TINY_FINANCIAL_MAP[situacao] || 'paid';
  const needsDetail = ['Aprovado', 'Preparando Envio', 'Faturado', 'Pronto para Envio'].includes(situacao);
  const isShipped = ['Enviado', 'Entregue', 'Não Entregue'].includes(situacao);

  while (hasMore) {
    if (Date.now() - startTime > timeoutMs) { console.log(`[${situacao}] timeout at page ${page}`); break; }

    console.log(`[Sync-${situacao}] page ${page}`);
    let data: any;
    try {
      data = await tinyV2Post(token, 'pedidos.pesquisa.php', { situacao, pagina: String(page) });
    } catch (err: any) {
      console.error(`[${situacao}] search error page ${page}: ${err.message}`);
      break;
    }
    const pedidos = data.pedidos || [];
    if (pedidos.length === 0) { hasMore = false; break; }

    for (const wrapper of pedidos) {
      if (Date.now() - startTime > timeoutMs) break;
      const item = wrapper.pedido;
      if (!item) continue;
      const tinyId = String(item.id);
      const existing = existingMap.get(tinyId);

      if (existing) {
        // Update status if changed
        if (existing.expedition_status !== expeditionStatus && existing.expedition_status !== 'cancelled') {
          const updateData: any = { expedition_status: expeditionStatus };
          
          // For shipped orders, try to get tracking from detail
          if (isShipped && !existing.tracking_code) {
            try {
              await new Promise(r => setTimeout(r, 300));
              const detail = await tinyV2Post(token, 'pedido.obter.php', { id: tinyId });
              const pedido = detail.pedido;
              if (pedido?.codigo_rastreamento) {
                updateData.tracking_code = pedido.codigo_rastreamento;
              }
            } catch (e: any) {
              console.error(`Detail fail for tracking ${tinyId}: ${e.message}`);
            }
          }

          await supabase.from('expedition_beta_orders').update(updateData).eq('id', existing.id);
          existing.expedition_status = expeditionStatus;
          updated++;
        }
        
        // Backfill items if missing
        if (!existing.has_items && needsDetail) {
          try {
            await new Promise(r => setTimeout(r, 300));
            const detail = await tinyV2Post(token, 'pedido.obter.php', { id: tinyId });
            const pedido = detail.pedido;
            if (pedido) {
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
                existing.has_items = true;
              }
            }
          } catch (e: any) {
            console.error(`Backfill fail ${tinyId}: ${e.message}`);
          }
        }
        
        skipped++;
        continue;
      }

      // New order - need detail to get full info
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

      const ecomNum = pedido.numero_ecommerce || '';
      const orderNum = String(pedido.numero || '');
      const finalShopifyId = ecomNum ? String(ecomNum) : `tiny-${tinyId}`;
      const cliente = pedido.cliente || {};
      const customerName = cliente.nome || cliente.fantasia || "Cliente Tiny";
      const trackingCode = pedido.codigo_rastreamento || null;

      const { data: inserted, error: insertError } = await supabase
        .from("expedition_beta_orders")
        .insert({
          shopify_order_id: finalShopifyId,
          shopify_order_name: ecomNum ? `#${ecomNum}` : `T-${orderNum}`,
          shopify_order_number: ecomNum || orderNum,
          shopify_created_at: brDateToISO(pedido.data_pedido || pedido.data_criacao),
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
          financial_status: financialStatus,
          fulfillment_status: isShipped ? 'fulfilled' : 'unfulfilled',
          expedition_status: expeditionStatus,
          subtotal_price: parseFloat(pedido.totalProdutos || pedido.total_produtos || 0),
          total_price: parseFloat(pedido.totalPedido || pedido.total_pedido || 0),
          total_discount: parseFloat(pedido.desconto || 0),
          total_shipping: parseFloat(pedido.frete || 0),
          total_weight_grams: 0,
          has_gift: (pedido.obs || pedido.observacoes || '').toLowerCase().includes("brinde"),
          notes: pedido.obs || pedido.observacoes || null,
          tiny_order_id: tinyId,
          tiny_order_number: orderNum,
          tracking_code: trackingCode,
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

      existingMap.set(tinyId, { id: inserted.id, expedition_status: expeditionStatus, tracking_code: trackingCode, has_items: rawItems.length > 0 });
      synced++;
    }

    page++;
    if (page > 10) hasMore = false;
  }

  return { synced, skipped, updated };
}

// === Cleanup: remove local approved orders no longer approved in Tiny ===
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
    const cleaned = await passCleanup(token, supabase, startTime, 25000);

    let totalSynced = 0, totalSkipped = 0, totalUpdated = 0;
    const results: Record<string, any> = {};

    // Sync each Tiny situacao with progressive timeouts
    for (const sit of TINY_SITUACOES) {
      if (Date.now() - startTime > 100000) {
        console.log(`Global timeout reached, skipping ${sit}`);
        break;
      }
      
      console.log(`=== Syncing: ${sit} ===`);
      const timeoutForSit = startTime + 110000; // 110s total budget
      const result = await passSituacao(token, supabase, existingMap, sit, startTime, 110000);
      results[sit] = result;
      totalSynced += result.synced;
      totalSkipped += result.skipped;
      totalUpdated += result.updated;
      console.log(`[${sit}] synced=${result.synced} updated=${result.updated} skipped=${result.skipped}`);
    }

    // Auto-enrich shipping info from Shopify
    let enrichResult = null;
    try {
      const enrichUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/expedition-enrich-shipping`;
      const enrichResp = await fetch(enrichUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      enrichResult = await enrichResp.json();
      console.log('Shipping enrichment result:', JSON.stringify(enrichResult));
    } catch (enrichErr: any) {
      console.error('Shipping enrichment error (non-blocking):', enrichErr.message);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s: ${cleaned} cleaned, ${totalSynced} synced, ${totalUpdated} updated, ${totalSkipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      synced: totalSynced,
      updated: totalUpdated,
      skipped: totalSkipped,
      cleaned,
      elapsed,
      results,
      enrichResult,
    }), {
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
