// Mercado Pago Point — cobranças integradas na maquininha (Orders API).
//
// Ações:
//   - "create": cria uma ordem de cobrança e a envia automaticamente para a
//               maquininha (terminal em modo PDV). POST /v1/orders.
//   - "status": consulta a situação de uma cobrança (GET /v1/orders/{id}) e
//               atualiza o registro local em point_payment_intents.
//   - "cancel": cancela uma ordem ainda não processada (POST /v1/orders/{id}/cancel).
//
// Usa o token da APLICAÇÃO Point (secret MP_POINT_ACCESS_TOKEN). As maquininhas
// físicas reais só respondem com o token de PRODUÇÃO da conta.
//
// Acesso: usuário autenticado (equipe interna).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MP_API = "https://api.mercadopago.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Mapeia o status da ordem MP para um status interno e indica se está paga.
function mapStatus(orderStatus: string | undefined | null): { status: string; paid: boolean } {
  const s = (orderStatus || "").toLowerCase();
  switch (s) {
    case "processed":
      return { status: "processed", paid: true };
    case "at_terminal":
      return { status: "at_terminal", paid: false };
    case "action_required":
      return { status: "action_required", paid: false };
    case "created":
      return { status: "created", paid: false };
    case "canceled":
    case "cancelled":
      return { status: "canceled", paid: false };
    case "refunded":
      return { status: "refunded", paid: false };
    case "failed":
      return { status: "failed", paid: false };
    case "expired":
      return { status: "expired", paid: false };
    default:
      return { status: s || "unknown", paid: false };
  }
}

function genExternalRef(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `BCPT-${ts}-${rand}`.slice(0, 64);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // --- Auth: exige usuário autenticado ---
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Faça login novamente." }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Sessão inválida. Faça login novamente." }, 401);
    }
    const userId = userData.user.id;

    const accessToken = Deno.env.get("MP_POINT_ACCESS_TOKEN");
    if (!accessToken) {
      return json(
        { error: "Credenciais da aplicação Point não configuradas (MP_POINT_ACCESS_TOKEN)." },
        400,
      );
    }
    const isSandbox = accessToken.startsWith("TEST-");

    const sb = createClient(url, serviceKey);

    let body: {
      action?: string;
      terminal_id?: string;
      amount?: number | string;
      description?: string;
      store_id?: string | null;
      sale_id?: string | null;
      intent_id?: string;
      order_id?: string;
      expiration_minutes?: number;
    } = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }
    const action = body.action || "create";

    const mpHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    // ===================== CREATE =====================
    if (action === "create") {
      const terminalId = (body.terminal_id || "").trim();
      const amountNum = Number(body.amount);
      if (!terminalId) return json({ error: "Selecione a maquininha (terminal)." }, 400);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return json({ error: "Informe um valor válido para a cobrança." }, 400);
      }
      const amountStr = amountNum.toFixed(2);
      const externalRef = genExternalRef();
      const expMin = Math.min(Math.max(Number(body.expiration_minutes) || 10, 1), 180);

      // 1) Registra a intenção localmente (pending) — garante rastreio mesmo se algo falhar depois.
      const { data: intent, error: insErr } = await sb
        .from("point_payment_intents")
        .insert({
          external_reference: externalRef,
          terminal_id: terminalId,
          amount: amountNum,
          description: body.description || null,
          status: "pending",
          store_id: body.store_id || null,
          sale_id: body.sale_id || null,
          is_sandbox: isSandbox,
          created_by: userId,
        })
        .select()
        .single();
      if (insErr) {
        console.error("[point-create-order] insert intent error", insErr.message);
        return json({ error: "Falha ao registrar a cobrança." }, 500);
      }

      // 2) Cria a ordem no Mercado Pago (envia automaticamente pra maquininha).
      const payload = {
        type: "point",
        external_reference: externalRef,
        expiration_time: `PT${expMin}M`,
        transactions: { payments: [{ amount: amountStr }] },
        config: { point: { terminal_id: terminalId } },
        description: body.description || undefined,
      };

      const resp = await fetch(`${MP_API}/v1/orders`, {
        method: "POST",
        headers: { ...mpHeaders, "X-Idempotency-Key": externalRef },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.error("[point-create-order] create error", resp.status, JSON.stringify(data));
        const msg =
          data?.message ||
          data?.errors?.[0]?.message ||
          `Erro Mercado Pago (${resp.status})`;
        await sb
          .from("point_payment_intents")
          .update({ status: "error", error_message: msg, raw_response: data })
          .eq("id", intent.id);
        return json({ error: msg, mp_status: resp.status, intent_id: intent.id }, 200);
      }

      const orderId = data?.id ?? null;
      const paymentId = data?.transactions?.payments?.[0]?.id ?? null;
      const mapped = mapStatus(data?.status);

      const { data: updated } = await sb
        .from("point_payment_intents")
        .update({
          mp_order_id: orderId,
          mp_payment_id: paymentId,
          status: mapped.status,
          mp_status: data?.status || null,
          raw_response: data,
        })
        .eq("id", intent.id)
        .select()
        .single();

      return json({
        ok: true,
        is_sandbox: isSandbox,
        intent: updated || intent,
        mp_order_id: orderId,
        status: mapped.status,
      });
    }

    // ===================== STATUS =====================
    if (action === "status") {
      // Resolve a intenção (por id local ou order_id MP).
      let intentRow: any = null;
      if (body.intent_id) {
        const { data } = await sb
          .from("point_payment_intents")
          .select("*")
          .eq("id", body.intent_id)
          .maybeSingle();
        intentRow = data;
      } else if (body.order_id) {
        const { data } = await sb
          .from("point_payment_intents")
          .select("*")
          .eq("mp_order_id", body.order_id)
          .maybeSingle();
        intentRow = data;
      }
      const orderId = body.order_id || intentRow?.mp_order_id;
      if (!orderId) return json({ error: "Cobrança não encontrada." }, 404);

      const resp = await fetch(`${MP_API}/v1/orders/${orderId}`, { headers: mpHeaders });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error("[point-create-order] status error", resp.status, JSON.stringify(data));
        return json(
          { error: data?.message || `Erro Mercado Pago (${resp.status})`, mp_status: resp.status },
          200,
        );
      }
      const mapped = mapStatus(data?.status);
      const paymentId = data?.transactions?.payments?.[0]?.id ?? intentRow?.mp_payment_id ?? null;

      let updated = intentRow;
      if (intentRow) {
        const upd: Record<string, unknown> = {
          status: mapped.status,
          mp_status: data?.status || null,
          mp_payment_id: paymentId,
          raw_response: data,
        };
        if (mapped.paid && !intentRow.paid_at) upd.paid_at = new Date().toISOString();
        const { data: u } = await sb
          .from("point_payment_intents")
          .update(upd)
          .eq("id", intentRow.id)
          .select()
          .single();
        updated = u || intentRow;
      }

      return json({ ok: true, status: mapped.status, paid: mapped.paid, intent: updated });
    }

    // ===================== CANCEL =====================
    if (action === "cancel") {
      let orderId = body.order_id;
      if (!orderId && body.intent_id) {
        const { data } = await sb
          .from("point_payment_intents")
          .select("mp_order_id")
          .eq("id", body.intent_id)
          .maybeSingle();
        orderId = data?.mp_order_id || undefined;
      }
      if (!orderId) return json({ error: "Cobrança não encontrada para cancelar." }, 404);

      const resp = await fetch(`${MP_API}/v1/orders/${orderId}/cancel`, {
        method: "POST",
        headers: mpHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error("[point-create-order] cancel error", resp.status, JSON.stringify(data));
        return json(
          {
            error:
              data?.message ||
              "Não foi possível cancelar. Se já está na maquininha, cancele pela tela do aparelho.",
            mp_status: resp.status,
          },
          200,
        );
      }
      const mapped = mapStatus(data?.status);
      if (body.intent_id || orderId) {
        await sb
          .from("point_payment_intents")
          .update({ status: mapped.status, mp_status: data?.status || "canceled", raw_response: data })
          .eq("mp_order_id", orderId);
      }
      return json({ ok: true, status: mapped.status, result: data });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err: any) {
    console.error("[point-create-order] fatal", err?.message);
    return json({ error: err?.message || "Erro interno" }, 500);
  }
});
