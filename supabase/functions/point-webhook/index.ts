// Mercado Pago Point — webhook de notificações das maquininhas (Orders API).
//
// O Mercado Pago envia um POST com query (?data.id=ORD...&type=order) e corpo
// com "action" (order.processed, order.canceled, order.refunded,
// order.action_required, order.failed, order.expired).
//
// Por segurança, NÃO confiamos só no corpo: re-consultamos a ordem na API do MP
// (fonte da verdade) e atualizamos o registro em point_payment_intents.
//
// Configurar no painel do Mercado Pago em Webhooks > evento "Order (Mercado Pago)".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MP_API = "https://api.mercadopago.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapStatus(orderStatus: string | undefined | null): { status: string; paid: boolean } {
  const s = (orderStatus || "").toLowerCase();
  if (s === "processed") return { status: "processed", paid: true };
  if (s === "at_terminal") return { status: "at_terminal", paid: false };
  if (s === "action_required") return { status: "action_required", paid: false };
  if (s === "created") return { status: "created", paid: false };
  if (s === "canceled" || s === "cancelled") return { status: "canceled", paid: false };
  if (s === "refunded") return { status: "refunded", paid: false };
  if (s === "failed") return { status: "failed", paid: false };
  if (s === "expired") return { status: "expired", paid: false };
  return { status: s || "unknown", paid: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Sempre responder 200 rápido pro MP não reenviar em loop.
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, serviceKey);

    const reqUrl = new URL(req.url);
    let payload: any = {};
    try {
      payload = await req.json();
    } catch (_e) {
      payload = {};
    }

    const type = payload?.type || reqUrl.searchParams.get("type") || "";
    const action = payload?.action || "";
    const dataId =
      payload?.data?.id ||
      reqUrl.searchParams.get("data.id") ||
      reqUrl.searchParams.get("id") ||
      "";

    console.log("[point-webhook] received", JSON.stringify({ type, action, dataId }));

    // Só tratamos notificações de ordem (Point).
    if (!String(type).includes("order") && !String(action).startsWith("order.")) {
      return json({ ok: true, ignored: true });
    }
    if (!dataId) return json({ ok: true, no_data_id: true });

    const accessToken = Deno.env.get("MP_POINT_ACCESS_TOKEN");
    if (!accessToken) {
      console.warn("[point-webhook] MP_POINT_ACCESS_TOKEN ausente");
      return json({ ok: true, no_token: true });
    }

    // Re-consulta a ordem no MP (fonte da verdade).
    const resp = await fetch(`${MP_API}/v1/orders/${dataId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const order = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[point-webhook] fetch order error", resp.status, JSON.stringify(order));
      // Mesmo sem conseguir consultar, registramos pelo action recebido.
      const fallback = action.replace("order.", "");
      await sb
        .from("point_payment_intents")
        .update({ status: mapStatus(fallback).status, mp_status: fallback })
        .eq("mp_order_id", dataId);
      return json({ ok: true, fetch_failed: true });
    }

    const mapped = mapStatus(order?.status);
    const externalRef = order?.external_reference || null;
    const paymentId = order?.transactions?.payments?.[0]?.id ?? null;

    // Localiza a intenção por order_id ou external_reference.
    let intentRow: any = null;
    {
      const { data } = await sb
        .from("point_payment_intents")
        .select("*")
        .eq("mp_order_id", dataId)
        .maybeSingle();
      intentRow = data;
    }
    if (!intentRow && externalRef) {
      const { data } = await sb
        .from("point_payment_intents")
        .select("*")
        .eq("external_reference", externalRef)
        .maybeSingle();
      intentRow = data;
    }

    if (!intentRow) {
      console.warn("[point-webhook] intent não encontrada", dataId, externalRef);
      return json({ ok: true, intent_not_found: true });
    }

    const upd: Record<string, unknown> = {
      status: mapped.status,
      mp_status: order?.status || null,
      mp_order_id: dataId,
      mp_payment_id: paymentId || intentRow.mp_payment_id || null,
      raw_response: order,
    };
    if (mapped.paid && !intentRow.paid_at) upd.paid_at = new Date().toISOString();

    await sb.from("point_payment_intents").update(upd).eq("id", intentRow.id);

    console.log(
      "[point-webhook] updated intent",
      intentRow.id,
      "->",
      mapped.status,
      mapped.paid ? "(PAGO)" : "",
    );

    return json({ ok: true, status: mapped.status, paid: mapped.paid });
  } catch (err: any) {
    console.error("[point-webhook] fatal", err?.message);
    return json({ ok: true, error: err?.message });
  }
});
