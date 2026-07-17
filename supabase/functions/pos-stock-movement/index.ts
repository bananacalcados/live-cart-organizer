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
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    const { data: prod, error: prodErr } = await supabase
      .from("pos_products")
      .select("id, stock, store_id, sku, barcode, name, tiny_id")
      .eq("id", product_id)
      .maybeSingle();
    if (prodErr) throw prodErr;
    if (!prod) throw new Error("Produto não encontrado");

    const previous = Number(prod.stock || 0);
    let next: number;
    let direction: "in" | "out";
    let deltaQty: number;

    if (movement_type === "entrada") {
      next = previous + qty;
      direction = "in";
      deltaQty = qty;
    } else if (movement_type === "saida") {
      next = Math.max(0, previous - qty);
      direction = "out";
      deltaQty = qty;
    } else {
      // balanço → valor absoluto
      next = qty;
      direction = next >= previous ? "in" : "out";
      deltaQty = Math.abs(next - previous);
    }

    // 1) Grava histórico ANTES (evita trigger de blindagem duplicar)
    const { error: adjErr } = await supabase.from("pos_stock_adjustments").insert({
      store_id: prod.store_id,
      product_id: prod.id,
      tiny_id: prod.tiny_id ?? null,
      sku: prod.sku,
      barcode: prod.barcode,
      product_name: prod.name ?? "—",
      direction,
      quantity: deltaQty,
      previous_stock: previous,
      new_stock: next,
      reason: reason ?? null,
      movement_type,
      user_id: userId,
      user_name: userName,
    });
    if (adjErr) throw adjErr;

    // 2) Atualiza estoque
    const { error: updErr } = await supabase
      .from("pos_products")
      .update({ stock: next, synced_at: new Date().toISOString() })
      .eq("id", prod.id);
    if (updErr) throw updErr;

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
});
