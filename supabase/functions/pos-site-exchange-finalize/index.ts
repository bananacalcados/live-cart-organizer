// pos-site-exchange-finalize
// Orquestra a "Troca do Site": depois que a venda da vendedora já foi criada no
// PDV (pos-tiny-create-sale), esta função:
//   1) Trava/registra a troca em pos_site_exchanges (1 por pedido do site).
//   2) Cancela o pedido original na Shopify.
//   3) Cancela o pedido do site no PDV (pos_sales), Expedição Beta e kanban orders.
//   4) Zera o estoque do(s) produto(s) que faltou(faltaram) em TODAS as lojas e
//      espelha o zero na Shopify (shopify-mirror-stock).
//
// É idempotente e por etapa: se algo falhar depois da venda criada, a venda NÃO
// é perdida — a função pode ser rechamada e retoma apenas as etapas pendentes.
//
// Body: {
//   new_pos_sale_id, original_pos_sale_id, shopify_order_id, shopify_order_name,
//   seller_id, store_id, exchange_reason, original_items, missing_barcodes,
//   seller_name
// }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Exige um JWT válido (equipe logada). Não exige admin — quem opera é a vendedora.
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await anon.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const {
      new_pos_sale_id,
      original_pos_sale_id,
      shopify_order_id,
      shopify_order_name,
      seller_id,
      store_id,
      exchange_reason,
      original_items,
      missing_barcodes,
      missing_items,
      seller_name,
    } = body || {};

    if (!shopify_order_id) return json({ error: "shopify_order_id é obrigatório" }, 400);
    if (!new_pos_sale_id) return json({ error: "new_pos_sale_id é obrigatório" }, 400);

    // Itens que faltaram (a serem zerados). Aceita {sku, barcode} para casar
    // tanto por código de barras quanto por SKU (itens do site às vezes não têm barcode).
    const rawMissing: Array<{ sku?: string; barcode?: string }> = Array.isArray(missing_items)
      ? missing_items
      : (Array.isArray(missing_barcodes) ? missing_barcodes.map((b: any) => ({ barcode: b })) : []);
    const missingSkus = [...new Set(rawMissing.map((m) => String(m?.sku || "").trim()).filter(Boolean))];
    const missingBarcodes = [...new Set(rawMissing.map((m) => String(m?.barcode || "").trim()).filter(Boolean))];

    // ── 1) Trava / registro ──────────────────────────────────────────────────
    const { data: existing } = await db
      .from("pos_site_exchanges")
      .select("id, status, step_status")
      .eq("shopify_order_id", String(shopify_order_id))
      .maybeSingle();

    // Se já foi concluída por OUTRA venda, bloqueia (evita conversão dupla).
    if (
      existing &&
      existing.status === "completed" &&
      existing.new_pos_sale_id &&
      existing.new_pos_sale_id !== new_pos_sale_id
    ) {
      return json(
        { error: "Este pedido do site já foi convertido em outra troca.", code: "ALREADY_EXCHANGED" },
        409,
      );
    }

    const step: Record<string, string> = { ...(existing?.step_status as any || {}) };

    const baseRow = {
      shopify_order_id: String(shopify_order_id),
      shopify_order_name: shopify_order_name || null,
      original_pos_sale_id: original_pos_sale_id || null,
      new_pos_sale_id,
      seller_id: seller_id || null,
      store_id: store_id || null,
      exchange_reason: exchange_reason || null,
      original_items: Array.isArray(original_items) ? original_items : [],
      zeroed_barcodes: [...missingBarcodes, ...missingSkus],
      created_by: callerId,
      status: "processing",
    };

    let exchangeId = existing?.id as string | undefined;
    if (exchangeId) {
      await db.from("pos_site_exchanges").update(baseRow).eq("id", exchangeId);
    } else {
      const { data: ins, error: insErr } = await db
        .from("pos_site_exchanges")
        .insert(baseRow)
        .select("id")
        .single();
      if (insErr) {
        // Corrida: alguém inseriu no meio tempo → conflito no unique
        return json(
          { error: "Este pedido do site já está sendo convertido.", code: "RACE", detail: insErr.message },
          409,
        );
      }
      exchangeId = ins.id;
    }

    const persistStep = async (patch: Record<string, string>) => {
      Object.assign(step, patch);
      await db.from("pos_site_exchanges").update({ step_status: step }).eq("id", exchangeId!);
    };

    // ── 2) Cancela o pedido na Shopify ───────────────────────────────────────
    if (step.shopify_cancelled !== "ok") {
      try {
        if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) throw new Error("Shopify env ausente");
        const resp = await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/orders/${shopify_order_id}/cancel.json`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOPIFY_TOKEN },
            body: JSON.stringify({ email: false, restock: false, reason: "other" }),
          },
        );
        if (!resp.ok) {
          const txt = await resp.text();
          // 422 + "cancel" = já estava cancelado → tratamos como sucesso
          if (resp.status === 422 && txt.toLowerCase().includes("cancel")) {
            await persistStep({ shopify_cancelled: "already" });
          } else {
            throw new Error(`Shopify ${resp.status}: ${txt.slice(0, 200)}`);
          }
        } else {
          await persistStep({ shopify_cancelled: "ok" });
        }
      } catch (e) {
        await persistStep({ shopify_cancelled: "failed" });
        await db.from("pos_site_exchanges")
          .update({ status: "failed_shopify_cancel", error_message: String((e as Error).message) })
          .eq("id", exchangeId!);
        return json({ error: `Falha ao cancelar na Shopify: ${(e as Error).message}`, exchange_id: exchangeId, step }, 502);
      }
    }

    // ── 3) Cancela nas tabelas internas ──────────────────────────────────────
    // 3a) pos_sales do site
    try {
      const note = `Convertido em Troca do Site (venda ${new_pos_sale_id}).`;
      if (original_pos_sale_id) {
        await db.from("pos_sales")
          .update({ status: "cancelled", notes: note })
          .eq("id", original_pos_sale_id);
      } else {
        await db.from("pos_sales")
          .update({ status: "cancelled", notes: note })
          .eq("external_source", "shopify")
          .eq("external_order_id", String(shopify_order_id));
      }
      await persistStep({ pos_sale_cancelled: "ok" });
    } catch (e) {
      await persistStep({ pos_sale_cancelled: "failed" });
    }

    // 3b) expedition_beta_orders
    try {
      await db.from("expedition_beta_orders")
        .update({ expedition_status: "cancelled" })
        .eq("shopify_order_id", String(shopify_order_id));
      await persistStep({ expedition_cancelled: "ok" });
    } catch (e) {
      await persistStep({ expedition_cancelled: "failed" });
    }

    // 3c) orders (kanban)
    try {
      await db.from("orders")
        .update({ stage: "cancelled" })
        .eq("shopify_order_id", String(shopify_order_id));
      await persistStep({ orders_cancelled: "ok" });
    } catch (e) {
      await persistStep({ orders_cancelled: "failed" });
    }

    // ── 4) Zera estoque do produto que faltou (todas as lojas) + Shopify ──────
    const hasMissing = missingBarcodes.length > 0 || missingSkus.length > 0;
    if (hasMissing && step.stock_zeroed !== "ok") {
      try {
        // Casa por barcode OU por sku (itens do site às vezes não têm barcode)
        const ors: string[] = [];
        if (missingBarcodes.length > 0) ors.push(`barcode.in.(${missingBarcodes.map((b) => `"${b}"`).join(",")})`);
        if (missingSkus.length > 0) ors.push(`sku.in.(${missingSkus.map((s) => `"${s}"`).join(",")})`);
        const { data: rows } = await db
          .from("pos_products")
          .select("id, store_id, tiny_id, sku, barcode, name, variant, stock")
          .or(ors.join(","));

        const mirrorItems: Array<{ barcode?: string; sku?: string }> = [];
        for (const r of rows || []) {
          const prev = Number(r.stock || 0);
          if (prev !== 0) {
            await db.from("pos_products").update({ stock: 0 }).eq("id", r.id);
            await db.from("pos_stock_adjustments").insert({
              store_id: r.store_id,
              product_id: r.id,
              tiny_id: r.tiny_id ?? null,
              sku: r.sku ?? null,
              barcode: r.barcode ?? null,
              product_name: r.name || r.variant || "Produto",
              direction: "out",
              quantity: prev,
              previous_stock: prev,
              new_stock: 0,
              reason: "Troca do Site — produto sem estoque zerado",
              seller_id: seller_id || null,
              seller_name: seller_name || null,
            });
          }
          mirrorItems.push({ barcode: r.barcode || undefined, sku: r.sku || undefined });
        }
        // Espelha o zero na Shopify (SET absoluto = soma de todas as lojas = 0)
        try {
          const items = mirrorItems.length > 0
            ? mirrorItems
            : [...missingBarcodes.map((b) => ({ barcode: b })), ...missingSkus.map((s) => ({ sku: s }))];
          await db.functions.invoke("shopify-mirror-stock", {
            body: { items, sale_event: "site_exchange" },
          });
        } catch (_) { /* mirror é best-effort; o cron/trigger reconcilia */ }
        await persistStep({ stock_zeroed: "ok" });
      } catch (e) {
        await persistStep({ stock_zeroed: "failed" });
      }
    } else if (!hasMissing) {
      await persistStep({ stock_zeroed: "skipped" });
    }


    // ── 5) Conclui ───────────────────────────────────────────────────────────
    const anyFailed = Object.values(step).some((v) => v === "failed");
    await db.from("pos_site_exchanges")
      .update({ status: anyFailed ? "completed_with_warnings" : "completed", error_message: null })
      .eq("id", exchangeId!);

    return json({
      ok: true,
      exchange_id: exchangeId,
      status: anyFailed ? "completed_with_warnings" : "completed",
      step,
    });
  } catch (e) {
    console.error("[pos-site-exchange-finalize]", e);
    return json({ error: (e as Error).message || "Erro interno" }, 500);
  }
});
