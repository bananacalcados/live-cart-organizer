import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { listAllMpAccountsForPolling } from "../_shared/mp-account.ts";
import { mpGetPayment } from "../_shared/mp-http.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Read-only, manually invoked incident audit. No charges, notifications or writes.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ error: "Configuração indisponível" }, 503);
    const sb = createClient(url, key);
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authError } = await sb.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Entre na sua conta" }, 401);
    const { data: role } = await sb.from("user_roles").select("role").eq("user_id", auth.user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Somente administração" }, 403);
    const body = await req.json();
    const entity = body.entity === "sales" ? "sales" : "orders";
    const offset = Number(body.offset || 0);
    const since = String(body.since || "2026-10-15T00:00:00Z");
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isFinite(Date.parse(since))) return json({ error: "Período inválido" }, 400);
    const columns = entity === "orders"
      ? "id,paid_at,mercadopago_payment_id,appmax_order_id,pagarme_order_id,payment_confirmed_source,products,discount_type,discount_value,shipping_cost,free_shipping"
      : "id,paid_at,mercadopago_payment_id,appmax_order_id,pagarme_order_id,source_order_id,total,payment_gateway,payment_method,customer_name";
    let query = sb.from(entity === "orders" ? "orders" : "pos_sales").select(columns, { count: "exact" }).gte("paid_at", since);
    query = entity === "orders" ? query.eq("is_paid", true) : query.in("status", ["paid", "completed"]);
    const { data: rows, error, count } = await query.order("paid_at").order("id").range(offset, offset + 49);
    if (error) return json({ error: "Consulta indisponível" }, 503);
    const ids = (rows || []).map((r: any) => r.id);
    const { data: attempts, error: attemptError } = ids.length ? await sb.from("pos_checkout_attempts")
      .select("sale_id,gateway,transaction_id,amount,status").in("sale_id", ids).eq("status", "success").limit(1000) : { data: [], error: null };
    if (attemptError) return json({ error: "Comprovantes indisponíveis" }, 503);
    const accounts = await listAllMpAccountsForPolling(sb);
    let appmaxToken = "";
    const { data: installation } = await sb.from("appmax_installations").select("merchant_client_id,merchant_client_secret").eq("env", "production").eq("status", "installed").maybeSingle();
    if (installation) {
      const response = await fetch("https://auth.appmax.com.br/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: installation.merchant_client_id, client_secret: installation.merchant_client_secret }) });
      if (response.ok) appmaxToken = String((await response.json()).access_token || "");
    }
    const results: any[] = [];
    // Bounded concurrency: three provider reads at a time.
    for (let start = 0; start < (rows || []).length; start += 3) {
      results.push(...await Promise.all((rows || []).slice(start, start + 3).map(async (row: any) => {
        if (entity === "sales" && row.source_order_id) return { id: row.id, orderId: row.source_order_id, result: "linked_order" };
        const evidence = (attempts || []).filter((a: any) => a.sale_id === row.id);
        const proofs: any[] = [];
        const mpId = row.mercadopago_payment_id || evidence.find((a: any) => a.gateway === "mercadopago")?.transaction_id;
        if (mpId) {
          for (const account of accounts) {
            try {
              const response = await mpGetPayment(account.access_token, mpId);
              if (!response.ok) continue;
              const payment = await response.json();
              proofs.push({ gateway: "mercadopago", status: payment.status, real: payment.live_mode === true, reference: payment.external_reference, amount: payment.transaction_amount, approved: payment.status === "approved" && payment.live_mode === true && payment.external_reference === row.id });
              break;
            } catch { /* Preserve unverified instead of approving. */ }
          }
        }
        // A later rejected/cancelled attempt may overwrite the stored ID.
        // Search only this exact reference before declaring it unverified.
        if (!proofs.some(p => p.approved)) {
          for (const account of accounts) {
            try {
              const response = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(row.id)}&limit=100&sort=date_created&criteria=desc`, { headers: { Authorization: `Bearer ${account.access_token}` } });
              if (!response.ok) continue;
              const payload = await response.json();
              for (const payment of payload.results || []) {
                if (payment.external_reference !== row.id || payment.status !== "approved" || payment.live_mode !== true) continue;
                proofs.push({ gateway: "mercadopago", status: payment.status, real: true, reference: payment.external_reference, amount: payment.transaction_amount, approved: true, foundByReference: true });
              }
              if (proofs.some(p => p.approved)) break;
            } catch { /* Keep unresolved if search fails. */ }
          }
        }
        if (row.appmax_order_id && appmaxToken) {
          try {
            const response = await fetch(`https://api.appmax.com.br/v1/orders/${encodeURIComponent(row.appmax_order_id)}`, { headers: { Authorization: `Bearer ${appmaxToken}` } });
            if (response.ok) {
              const payload = await response.json();
              const order = payload.data?.order || payload.data;
              const status = String(order?.status || "").toLowerCase();
              proofs.push({ gateway: "appmax", status, orderId: String(order?.id || ""), amount: order?.total || order?.total_amount || null, approved: String(order?.id || "") === String(row.appmax_order_id) && ["aprovado", "approved", "paid", "pago", "integrado"].includes(status) });
            }
          } catch { /* No provider response is not proof. */ }
        }
        if (!proofs.some(p => p.approved) && row.appmax_order_id) {
          const legacyToken = Deno.env.get("APPMAX_ACCESS_TOKEN");
          if (legacyToken) {
            try {
              const response = await fetch(`https://admin.appmax.com.br/api/v3/order/${encodeURIComponent(row.appmax_order_id)}`, { headers: { "access-token": legacyToken } });
              if (response.ok) {
                const payload = await response.json();
                const order = payload.data?.order || payload.data;
                const status = String(order?.status || "").toLowerCase();
                proofs.push({ gateway: "appmax", status, legacy: true, orderId: String(order?.id || ""), approved: String(order?.id || "") === String(row.appmax_order_id) && ["aprovado", "approved", "paid", "pago", "integrado"].includes(status) });
              }
            } catch { /* Missing proof remains unresolved. */ }
          }
        }
        if (!proofs.some(p => p.approved) && row.pagarme_order_id) {
          const pagarmeKey = Deno.env.get("PAGARME_SECRET_KEY");
          if (pagarmeKey) {
            try {
              const response = await fetch(`https://api.pagar.me/core/v5/orders/${encodeURIComponent(row.pagarme_order_id)}`, { headers: { Authorization: `Basic ${btoa(pagarmeKey + ":")}` } });
              if (response.ok) {
                const order = await response.json();
                proofs.push({ gateway: "pagarme", status: order.status, amount: Number(order.amount || 0) / 100, approved: order.id === row.pagarme_order_id && order.status === "paid" });
              }
            } catch { /* Missing proof remains unresolved. */ }
          }
        }
        return { id: row.id, name: row.customer_name, result: proofs.some(p => p.approved) ? "provider_confirmed" : "needs_review", proofs, source: row.payment_confirmed_source || row.payment_method, hasRecordedSuccess: evidence.length > 0 };
      })));
    }
    return json({ entity, since, offset, total: count, nextOffset: offset + results.length < Number(count) ? offset + results.length : null, results });
  } catch { return json({ error: "Auditoria indisponível; nenhum pedido foi alterado" }, 503); }
});