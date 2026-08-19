import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function probe(token: string, label: string) {
  const out: any = { account: label, tokenPrefix: token.slice(0, 8) };

  // 1) Quem é o dono do token
  try {
    const r = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    out.usersMe = {
      http: r.status,
      id: j.id,
      nickname: j.nickname,
      site_id: j.site_id,
      user_type: j.user_type,
      status: j.status,
      tags: j.tags,
      email: j.email ? "presente" : null,
    };
  } catch (e: any) {
    out.usersMe = { error: e.message };
  }

  // 2) Métodos de pagamento habilitados (não cria nada)
  try {
    const r = await fetch("https://api.mercadopago.com/v1/payment_methods", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    out.paymentMethods = {
      http: r.status,
      count: Array.isArray(j) ? j.length : null,
      hasPix: Array.isArray(j) ? j.some((m: any) => m.id === "pix") : null,
      pixStatus: Array.isArray(j) ? j.find((m: any) => m.id === "pix")?.status : null,
      body: Array.isArray(j) ? undefined : j,
    };
  } catch (e: any) {
    out.paymentMethods = { error: e.message };
  }

  // 3) POST mínimo de PIX (R$ 1,00) — o teste que isola o 403
  try {
    const body = {
      transaction_amount: 1,
      payment_method_id: "pix",
      description: "Teste diagnostico",
      payer: { email: "teste.diagnostico@bananacalcados.com.br" },
    };
    const r = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    out.minimalPix = {
      http: r.status,
      requestId: r.headers.get("x-request-id"),
      body: text.slice(0, 800),
    };
  } catch (e: any) {
    out.minimalPix = { error: e.message };
  }

  // 4) POST mínimo sem headers extras de integração
  try {
    const r = await fetch("https://api.mercadopago.com/v1/payments/search?limit=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    out.search = { http: r.status, total: j?.paging?.total };
  } catch (e: any) {
    out.search = { error: e.message };
  }

  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: any[] = [];
  const { data } = await supabase
    .from("mercadopago_accounts")
    .select("id, name, access_token, is_active");
  for (const acc of data || []) {
    if (!acc.access_token) continue;
    results.push(await probe(acc.access_token, `${acc.name}${acc.is_active ? " (ativa)" : ""}`));
  }
  const envTok = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (envTok && !(data || []).some((a: any) => a.access_token === envTok)) {
    results.push(await probe(envTok, "ENV legado"));
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
