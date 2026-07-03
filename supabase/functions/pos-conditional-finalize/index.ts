// pos-conditional-finalize
// Finaliza um CONDICIONAL (pedido enviado ao cliente para experimentar).
// A vendedora puxa o condicional (status='conditional', is_conditional=true,
// conditional_status='draft_sent'), remove os itens DEVOLVIDOS e cobra os que
// ficaram. Esta função:
//   1) Trava por status (idempotente: se já 'finalized', retorna sucesso).
//   2) Restaura o estoque de cada item devolvido (restore_pos_sale_item_stock)
//      e remove esses itens de pos_sale_items.
//   3) Recalcula subtotal/total a partir dos itens mantidos.
//   4) Grava forma de pagamento, caixa, vendedora e marca conditional_status.
//   5) Transiciona status 'conditional' -> 'completed' (o trigger fatura e a
//      baixa dos itens mantidos é idempotente — não baixa de novo).
//   Se NENHUM item ficou, cancela a venda (status='cancelled').
//
// Body: {
//   sale_id, returned_items: [{sku?, barcode?}], payment_method,
//   payment_details, discount, cash_register_id, seller_id
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
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await anon.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const {
      sale_id,
      returned_items,
      payment_method,
      payment_details,
      discount,
      cash_register_id,
      seller_id,
    } = body || {};

    if (!sale_id) return json({ error: "sale_id é obrigatório" }, 400);

    // ── 1) Carrega e trava por status ────────────────────────────────────────
    const { data: sale, error: saleErr } = await db
      .from("pos_sales")
      .select("id, is_conditional, conditional_status, status")
      .eq("id", sale_id)
      .maybeSingle();
    if (saleErr) return json({ error: saleErr.message }, 500);
    if (!sale) return json({ error: "Venda não encontrada" }, 404);
    if (!sale.is_conditional) return json({ error: "Esta venda não é um condicional" }, 400);

    // Idempotência: já finalizado → sucesso sem repetir
    if (sale.conditional_status === "finalized") {
      return json({ ok: true, status: sale.status, already_finalized: true });
    }

    const returned: Array<{ sku?: string; barcode?: string }> = Array.isArray(returned_items)
      ? returned_items
      : [];

    // ── 2) Restaura estoque dos devolvidos + remove de pos_sale_items ────────
    for (const it of returned) {
      const sku = String(it?.sku || "").trim();
      const barcode = String(it?.barcode || "").trim();
      if (!sku && !barcode) continue;
      try {
        await db.rpc("restore_pos_sale_item_stock", {
          p_sale_id: sale_id,
          p_sku: sku || null,
          p_barcode: barcode || null,
        });
      } catch (e) {
        console.error("[restore_pos_sale_item_stock]", sale_id, sku, barcode, e);
      }
      // remove a linha do item devolvido
      let del = db.from("pos_sale_items").delete().eq("sale_id", sale_id);
      if (barcode) del = del.eq("barcode", barcode);
      else del = del.eq("sku", sku);
      await del;
    }

    // ── 3) Recalcula totais a partir dos itens mantidos ──────────────────────
    const { data: kept } = await db
      .from("pos_sale_items")
      .select("total_price, unit_price, quantity")
      .eq("sale_id", sale_id);

    const keptRows = kept || [];
    const subtotal = keptRows.reduce(
      (acc, r) => acc + Number(r.total_price ?? Number(r.unit_price || 0) * Number(r.quantity || 0)),
      0,
    );
    const disc = Number(discount || 0);
    const total = Math.max(0, subtotal - disc);

    // ── 4/5) Atualiza pagamento + transiciona status ─────────────────────────
    const mergedDetails = {
      ...(typeof payment_details === "object" && payment_details ? payment_details : {}),
      conditional: true,
    };

    if (keptRows.length === 0) {
      // Cliente devolveu tudo → cancela a venda (estoque já restaurado via 'return',
      // o ramo de cancelamento ignora itens com sale_event='return').
      await db.from("pos_sales").update({
        status: "cancelled",
        conditional_status: "finalized",
        subtotal: 0,
        total: 0,
        payment_details: mergedDetails,
      }).eq("id", sale_id);
      return json({ ok: true, status: "cancelled", kept_items: 0 });
    }

    const update: Record<string, unknown> = {
      status: "completed",
      conditional_status: "finalized",
      subtotal,
      discount: disc,
      total,
      payment_details: mergedDetails,
      paid_at: new Date().toISOString(),
    };
    if (payment_method) update.payment_method = payment_method;
    if (cash_register_id) update.cash_register_id = cash_register_id;
    if (seller_id) update.seller_id = seller_id;

    const { error: updErr } = await db.from("pos_sales").update(update).eq("id", sale_id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, status: "completed", kept_items: keptRows.length, total });
  } catch (e) {
    console.error("[pos-conditional-finalize]", e);
    return json({ error: (e as Error).message || "Erro interno" }, 500);
  }
});
