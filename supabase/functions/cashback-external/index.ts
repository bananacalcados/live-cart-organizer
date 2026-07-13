// Integração de cashback com o site (outro projeto Lovable).
// Este projeto (PDV) é a FONTE ÚNICA da verdade do cashback.
// O site chama esta função para VALIDAR e RESGATAR cupons ao vivo.
// Como leem o mesmo registro, um cupom usado na loja física fica
// automaticamente inválido no site (e vice-versa).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-integration-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // --- Auth: segredo compartilhado entre os dois projetos ---
  const expected = Deno.env.get("CASHBACK_INTEGRATION_SECRET");
  const provided = req.headers.get("x-integration-secret");
  if (!expected || !provided || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action || "").toLowerCase();
  const couponCode = String(body.coupon_code || "").trim();

  if (!couponCode) return json({ error: "coupon_code é obrigatório" }, 400);

  try {
    // ---------- VALIDATE ----------
    if (action === "validate") {
      const subtotal = body.subtotal != null ? Number(body.subtotal) : null;

      const { data: cb, error } = await supabase
        .from("internal_cashback")
        .select(
          "id, customer_name, cashback_amount, min_purchase, expires_at, is_used",
        )
        .ilike("coupon_code", couponCode)
        .maybeSingle();

      if (error) {
        console.error("validate query error:", error.message);
        return json({ valid: false, error: "Erro ao validar cupom" }, 500);
      }
      if (!cb) return json({ valid: false, error: "Cupom não encontrado" });
      if (cb.is_used) return json({ valid: false, error: "Cashback já utilizado" });
      if (new Date(cb.expires_at) < new Date()) {
        return json({ valid: false, error: "Cashback expirado" });
      }
      if (subtotal != null && subtotal < Number(cb.min_purchase || 0)) {
        return json({
          valid: false,
          error: `Compra mínima de R$ ${Number(cb.min_purchase).toFixed(2)} para este cashback`,
          min_purchase: Number(cb.min_purchase || 0),
        });
      }

      return json({
        valid: true,
        type: "cashback",
        coupon_code: couponCode.toUpperCase(),
        discount: Number(cb.cashback_amount),
        min_purchase: Number(cb.min_purchase || 0),
        expires_at: cb.expires_at,
        label: `Cashback ${cb.customer_name || ""}`.trim(),
      });
    }

    // ---------- REDEEM (atômico) ----------
    if (action === "redeem") {
      const subtotal = body.subtotal != null ? Number(body.subtotal) : null;
      const externalRef =
        body.site_order_ref != null ? String(body.site_order_ref) : null;

      const { data, error } = await supabase.rpc("redeem_internal_cashback", {
        _coupon_code: couponCode,
        _channel: "site",
        _external_ref: externalRef,
        _subtotal: subtotal,
      });

      if (error) {
        console.error("redeem rpc error:", error.message);
        return json({ success: false, error: "Erro ao resgatar cupom" }, 500);
      }
      // A RPC retorna { success, discount, error, ... }
      return json(data);
    }

    return json({ error: "action inválida (use 'validate' ou 'redeem')" }, 400);
  } catch (e) {
    console.error("cashback-external error:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
