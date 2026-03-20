import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get all capture items for this session
    const { data: captureItems, error: itemsErr } = await supabase
      .from("product_capture_items")
      .select("barcode, parent_code, product_name, size, color, price, cost_price, quantity")
      .eq("session_id", session_id);

    if (itemsErr) throw itemsErr;
    if (!captureItems || captureItems.length === 0) {
      return new Response(
        JSON.stringify({ error: "No items found for this session" }),
        { status: 404, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // Build SKU set from barcodes
    const skuSet = new Set<string>();
    captureItems.forEach((item: any) => {
      if (item.barcode) skuSet.add(item.barcode);
    });
    const skuArray = Array.from(skuSet);

    if (skuArray.length === 0) {
      return new Response(
        JSON.stringify({ sales: [], totals: { total_pairs: 0, total_value: 0 } }),
        { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // 2. Query tiny_synced_orders - get all non-cancelled orders
    // We need to fetch in batches since there could be many orders
    const excludedStatuses = ["Cancelado", "Em aberto"];
    
    let allOrders: any[] = [];
    let offset = 0;
    const batchSize = 1000;
    
    while (true) {
      const { data: orders, error: ordersErr } = await supabase
        .from("tiny_synced_orders")
        .select("id, store_id, tiny_order_number, order_date, customer_name, status, total, items")
        .not("status", "in", `(${excludedStatuses.join(",")})`)
        .range(offset, offset + batchSize - 1)
        .order("order_date", { ascending: false });

      if (ordersErr) throw ordersErr;
      if (!orders || orders.length === 0) break;
      allOrders = allOrders.concat(orders);
      if (orders.length < batchSize) break;
      offset += batchSize;
    }

    // 3. Get store names
    const storeIds = [...new Set(allOrders.map((o: any) => o.store_id))];
    const { data: stores } = await supabase
      .from("pos_stores")
      .select("id, name")
      .in("id", storeIds);
    
    const storeMap = new Map<string, string>();
    (stores || []).forEach((s: any) => storeMap.set(s.id, s.name));

    // 4. Cross-reference SKUs with order items
    interface SaleMatch {
      sku: string;
      product_name: string;
      parent_code: string;
      store_name: string;
      store_id: string;
      order_number: string;
      order_date: string;
      customer_name: string;
      quantity_sold: number;
      unit_price: number;
      total: number;
      cost_price: number;
    }

    const sales: SaleMatch[] = [];

    // Build lookup from barcode to capture item info
    const barcodeInfo = new Map<string, any>();
    captureItems.forEach((item: any) => {
      barcodeInfo.set(item.barcode, item);
    });

    for (const order of allOrders) {
      if (!order.items || !Array.isArray(order.items)) continue;
      
      for (const orderItem of order.items) {
        const itemSku = orderItem.sku || orderItem.codigo || "";
        if (!itemSku || !skuSet.has(itemSku)) continue;

        const captureInfo = barcodeInfo.get(itemSku);
        
        sales.push({
          sku: itemSku,
          product_name: orderItem.name || orderItem.descricao || captureInfo?.product_name || "—",
          parent_code: captureInfo?.parent_code || "—",
          store_name: storeMap.get(order.store_id) || "Desconhecida",
          store_id: order.store_id,
          order_number: order.tiny_order_number || "—",
          order_date: order.order_date,
          customer_name: order.customer_name || "—",
          quantity_sold: orderItem.quantity || 1,
          unit_price: orderItem.unit_price || orderItem.valor_unitario || 0,
          total: (orderItem.quantity || 1) * (orderItem.unit_price || orderItem.valor_unitario || 0),
          cost_price: captureInfo?.cost_price || 0,
        });
      }
    }

    // 5. Calculate totals
    const totalPairs = sales.reduce((sum, s) => sum + s.quantity_sold, 0);
    const totalValue = sales.reduce((sum, s) => sum + s.total, 0);
    const totalCost = sales.reduce((sum, s) => sum + (s.cost_price * s.quantity_sold), 0);

    // Group by SKU for summary
    const bySkuMap = new Map<string, { sku: string; product_name: string; parent_code: string; total_qty: number; total_value: number; cost_price: number }>();
    for (const s of sales) {
      const existing = bySkuMap.get(s.sku);
      if (existing) {
        existing.total_qty += s.quantity_sold;
        existing.total_value += s.total;
      } else {
        bySkuMap.set(s.sku, {
          sku: s.sku,
          product_name: s.product_name,
          parent_code: s.parent_code,
          total_qty: s.quantity_sold,
          total_value: s.total,
          cost_price: s.cost_price,
        });
      }
    }

    // Group by store for summary
    const byStoreMap = new Map<string, { store_name: string; total_qty: number; total_value: number }>();
    for (const s of sales) {
      const existing = byStoreMap.get(s.store_name);
      if (existing) {
        existing.total_qty += s.quantity_sold;
        existing.total_value += s.total;
      } else {
        byStoreMap.set(s.store_name, {
          store_name: s.store_name,
          total_qty: s.quantity_sold,
          total_value: s.total,
        });
      }
    }

    return new Response(
      JSON.stringify({
        sales,
        by_sku: Array.from(bySkuMap.values()),
        by_store: Array.from(byStoreMap.values()),
        totals: {
          total_pairs: totalPairs,
          total_value: totalValue,
          total_cost: totalCost,
          total_profit: totalValue - totalCost,
        },
        capture_summary: {
          total_captured_skus: skuArray.length,
          total_captured_units: captureItems.reduce((s: number, i: any) => s + (i.quantity || 0), 0),
        },
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
