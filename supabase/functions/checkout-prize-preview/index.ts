import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Prévia (somente leitura) do prêmio da roleta aplicável a um pedido.
// Usada pelo checkout para exibir a linha "🎡 Prêmio: -R$ X" com o mesmo
// valor que o servidor irá abater na cobrança. NÃO reserva nem consome nada.
// Prêmio físico (prize_type = 'product') nunca entra aqui.

const DISCOUNT_TYPES = ["discount_percent", "discount_fixed", "free_shipping"];

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  let allow = "null";
  try {
    const { hostname, protocol } = new URL(origin);
    if (
      protocol === "https:" &&
      (hostname.endsWith("bananacalcados.com.br") ||
        hostname.endsWith(".lovable.app") ||
        hostname.endsWith(".lovableproject.com"))
    ) allow = origin;
  } catch { /* origin vazio */ }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });

  try {
    const { orderId, phone, baseAmount, shippingAmount } = await req.json();
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length < 8) return new Response(JSON.stringify({ prize: null }), { headers });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("customer_prizes")
      .select("id, prize_label, prize_type, prize_value, coupon_code, expires_at, applied_order_id, is_redeemed")
      .eq("is_redeemed", false)
      .in("prize_type", DISCOUNT_TYPES)
      .gt("expires_at", new Date().toISOString())
      .ilike("customer_phone", `%${digits.slice(-8)}`)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const base = Math.max(0, Number(baseAmount) || 0);
    const shipping = Math.max(0, Number(shippingAmount) || 0);

    const candidates = (data || [])
      .filter((p: any) => !p.applied_order_id || p.applied_order_id === orderId)
      .map((p: any) => {
        const value = Number(p.prize_value) || 0;
        let discountAmount = 0;
        let freeShipping = false;
        if (p.prize_type === "discount_percent") discountAmount = round2(base * (value / 100));
        else if (p.prize_type === "discount_fixed") discountAmount = round2(Math.min(value, base));
        else if (p.prize_type === "free_shipping") freeShipping = shipping > 0;
        return {
          label: p.prize_label,
          couponCode: p.coupon_code,
          prizeType: p.prize_type,
          discountAmount,
          freeShipping,
        };
      })
      .filter((p: any) => p.discountAmount > 0 || p.freeShipping)
      .sort(
        (a: any, b: any) =>
          (b.discountAmount + (b.freeShipping ? shipping : 0)) -
          (a.discountAmount + (a.freeShipping ? shipping : 0)),
      );

    return new Response(JSON.stringify({ prize: candidates[0] || null }), { headers });
  } catch (err) {
    console.error("[checkout-prize-preview]", err);
    return new Response(JSON.stringify({ prize: null }), { headers });
  }
});
