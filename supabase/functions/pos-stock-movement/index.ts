import { withAccessLog } from "../_shared/withAccessLog.ts";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Movimentação de estoque classificada (Entrada / Saída / Balanço).
 * Grava em pos_products + pos_stock_adjustments em uma única transação lógica.
 */
serve(withAccessLog("pos-stock-movement", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
// Fase 4 auth: funcionário com módulo ou chamada interna (service_role + x-internal-call).
{ const denied = await requireStaffOrInternal(req, ["inventory","pos"], false); if (denied) return denied; }

  try {
    const body = await req.json();
    const {
      product_id,
      movement_type, // 'entrada' | 'saida' | 'balanco'
      quantity,
      reason,
    } = body ?? {};

    if (!product_id) throw new Error("product_id é obrigatório");
    if (!["entrada", "saida", "balanco"].includes(movement_type)) {
      throw new Error("movement_type deve ser entrada, saida ou balanco");
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) throw new Error("quantidade inválida");
    if (movement_type !== "balanco" && qty <= 0) {
      throw new Error("quantidade deve ser maior que zero");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Identifica usuário chamador (opcional, via JWT)
    let userId: string | null = null;
    let userName: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const anonClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: u } = await anonClient.auth.getUser();
        userId = u?.user?.id ?? null;
        userName = (u?.user?.user_metadata as any)?.full_name || u?.user?.email || null;
      } catch (_) { /* ignore */ }
    }

    const SITE_LIVE_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";
    const { data: prod, error: prodErr } = await supabase
      .from("pos_products")
      .select("id, store_id, sku, barcode")
      .eq("id", product_id)
      .maybeSingle();
    if (prodErr) throw prodErr;
    if (!prod) throw new Error("Produto não encontrado");
    if (prod.store_id === SITE_LIVE_STORE_ID) {
      throw new Error("A loja Site/Live fica sempre com saldo zero. Faça o ajuste na Loja Pérola.");
    }

    // Grava SOMENTE pelas funções seguras do banco (trava a linha + histórico antes do saldo).
    const common = {
      p_product_id: prod.id,
      p_reason: reason ?? null,
      p_seller_id: null,
      p_seller_name: null,
      p_user_id: userId,
      p_user_name: userName,
    };
    const { data: rpcRes, error: rpcErr } = movement_type === "balanco"
      ? await supabase.rpc("pos_stock_balance_to", { ...common, p_target: qty })
      : await supabase.rpc("pos_stock_move", {
          ...common,
          p_direction: movement_type === "entrada" ? "in" : "out",
          p_quantity: qty,
        });
    if (rpcErr) throw rpcErr;
    const previous = Number((rpcRes as any)?.previous_stock ?? 0);
    const next = Number((rpcRes as any)?.new_stock ?? 0);

    // Espelho Shopify (não há trigger em pos_products): em background, nunca falha o ajuste.
    if (previous !== next && (prod.barcode || prod.sku)) {
      const mirror = supabase.functions
        .invoke("shopify-mirror-stock", {
          body: {
            sale_id: null,
            sale_event: "manual_adjust",
            items: [{ barcode: prod.barcode || undefined, sku: prod.sku || undefined }],
          },
        })
        .catch((e) => console.error("[pos-stock-movement] mirror error", e));
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(mirror); } catch (_) { /* ignore */ }
    }

    return new Response(
      JSON.stringify({ success: true, previous_stock: previous, new_stock: next }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[pos-stock-movement] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
