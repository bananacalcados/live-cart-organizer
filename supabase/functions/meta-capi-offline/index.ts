// Meta Conversions API — OFFLINE Events (Visita Loja Física)
// Envia eventos Purchase de vendas físicas do PDV para o Conjunto de Eventos Offline da Meta.
//
// SEGURANÇA:
//   - Função SÓ aceita chamadas autenticadas com SUPABASE_SERVICE_ROLE_KEY (verify_jwt = true)
//   - Disparo automático via trigger no banco quando pos_sales.status muda pra paid/completed
//   - Idempotência garantida pela tabela meta_capi_offline_log (UNIQUE sale_id+event_name)
//   - PIIs hasheados com SHA-256 antes de sair do servidor (CPF, email, telefone, nome, etc.)
//
// ENV:
//   - META_OFFLINE_CAPI_TOKEN  (token exclusivo do Dataset Visita Loja Física)
//   - META_OFFLINE_TEST_EVENT_CODE (opcional, pra testes via "Eventos de teste")
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const DATASET_ID = "1346445220878187"; // Visita Loja Física
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============ Helpers ============

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  // Garante DDI 55 pro Brasil
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return digits;
}

function normalizeEmail(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

function normalizeName(raw: string): string {
  return stripAccents((raw || "").trim().toLowerCase());
}

function normalizeCity(raw: string): string {
  return stripAccents((raw || "").toLowerCase()).replace(/[^a-z0-9]/g, "");
}

function normalizeState(raw: string): string {
  return stripAccents((raw || "").trim().toLowerCase()).replace(/[^a-z]/g, "");
}

function normalizeZip(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}

function normalizeCpf(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}

function splitName(full: string | null | undefined): { first?: string; last?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function hashIfPresent(raw: string | null | undefined): Promise<string | undefined> {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  return await sha256Hex(trimmed);
}

// ============ Handler ============

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEGURANÇA: aceita Authorization Bearer com SERVICE_ROLE_KEY OU
  // header X-Internal-Secret com META_CAPI_INTERNAL_SECRET (usado pela trigger do banco).
  // Qualquer outra chamada é rejeitada.
  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const internalSecretHeader = req.headers.get("X-Internal-Secret") || "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const INTERNAL_SECRET = Deno.env.get("META_CAPI_INTERNAL_SECRET") || "";

  const isServiceRole = SERVICE_ROLE_KEY && bearerToken === SERVICE_ROLE_KEY;
  const isInternalCall = INTERNAL_SECRET && internalSecretHeader === INTERNAL_SECRET;

  if (!isServiceRole && !isInternalCall) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let saleId: string | null = null;
  let testEventCodeFromBody: string | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    saleId = body?.sale_id || null;
    testEventCodeFromBody = body?.test_event_code;

    if (!saleId || typeof saleId !== "string") {
      return new Response(JSON.stringify({ error: "sale_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const META_TOKEN = Deno.env.get("META_OFFLINE_CAPI_TOKEN");
    if (!META_TOKEN) {
      return new Response(
        JSON.stringify({ error: "META_OFFLINE_CAPI_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const TEST_CODE = testEventCodeFromBody?.trim() || Deno.env.get("META_OFFLINE_TEST_EVENT_CODE")?.trim() || undefined;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) Busca a venda + cliente + loja
    const { data: sale, error: saleErr } = await supabase
      .from("pos_sales")
      .select(`
        id, total, status, created_at, paid_at, payment_method, sale_type,
        customer_id, store_id, notes, external_source, external_order_id,
        customer_name, customer_phone, customer_email, customer_cpf,
        customer_city, customer_state, customer_cep, shipping_address
      `)
      .eq("id", saleId)
      .maybeSingle();

    if (saleErr || !sale) {
      const errMsg = `sale not found: ${saleErr?.message || "no rows"}`;
      await supabase.from("meta_capi_offline_log").upsert({
        sale_id: saleId,
        event_name: "Purchase",
        event_id: `error_${saleId}`,
        dataset_id: DATASET_ID,
        status: "error",
        error_message: errMsg,
      }, { onConflict: "sale_id,event_name" });

      return new Response(JSON.stringify({ ok: false, error: errMsg }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotência: se já foi enviado com sucesso, retorna sem reenviar
    const { data: existingLog } = await supabase
      .from("meta_capi_offline_log")
      .select("status, event_id")
      .eq("sale_id", saleId)
      .eq("event_name", "Purchase")
      .maybeSingle();

    if (existingLog?.status === "sent") {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "already sent", event_id: existingLog.event_id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validação básica: tem que ter valor positivo
    const value = Number(sale.total || 0);
    if (value <= 0) {
      const errMsg = "sale has zero/negative total";
      await supabase.from("meta_capi_offline_log").upsert({
        sale_id: saleId,
        event_name: "Purchase",
        event_id: `error_${saleId}`,
        dataset_id: DATASET_ID,
        status: "error",
        error_message: errMsg,
      }, { onConflict: "sale_id,event_name" });

      return new Response(JSON.stringify({ ok: false, error: errMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Busca dados do cliente (PII)
    let customer: any = null;
    if (sale.customer_id) {
      const { data: c } = await supabase
        .from("pos_customers")
        .select("name, email, whatsapp, cpf, city, state, cep, gender")
        .eq("id", sale.customer_id)
        .maybeSingle();
      customer = c;
    }

    // 3) Busca dados da loja (pra context: city/state/zip)
    let store: any = null;
    if (sale.store_id) {
      const { data: s } = await supabase
        .from("pos_stores")
        .select("name, city, state, cep")
        .eq("id", sale.store_id)
        .maybeSingle();
      store = s;
    }

    // shipping_address jsonb fallback (transparent checkout / shopify)
    const shipAddr: any = sale.shipping_address || {};

    // Validação: precisa ter pelo menos UM identificador do cliente
    const phoneRaw = customer?.whatsapp || sale.customer_phone || shipAddr.phone || "";
    const emailRaw = customer?.email || sale.customer_email || shipAddr.email || "";
    const cpfRaw = customer?.cpf || sale.customer_cpf || shipAddr.cpf || "";
    const nameRaw = customer?.name || sale.customer_name || shipAddr.name || "";

    if (!phoneRaw && !emailRaw && !cpfRaw) {
      const errMsg = "no customer identifiers (phone/email/cpf) — skipping";
      await supabase.from("meta_capi_offline_log").upsert({
        sale_id: saleId,
        event_name: "Purchase",
        event_id: `skipped_${saleId}`,
        dataset_id: DATASET_ID,
        status: "skipped",
        error_message: errMsg,
      }, { onConflict: "sale_id,event_name" });

      return new Response(JSON.stringify({ ok: false, skipped: true, reason: errMsg }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4) Hasheia PIIs (SHA-256)
    const phoneNorm = normalizePhone(phoneRaw);
    const ph = phoneNorm ? await sha256Hex(phoneNorm) : undefined;
    const em = emailRaw ? await sha256Hex(normalizeEmail(emailRaw)) : undefined;
    const externalId = cpfRaw ? await sha256Hex(normalizeCpf(cpfRaw)) : (sale.customer_id ? await sha256Hex(sale.customer_id) : undefined);

    const { first, last } = splitName(nameRaw);
    const fn = first ? await hashIfPresent(normalizeName(first)) : undefined;
    const ln = last ? await hashIfPresent(normalizeName(last)) : undefined;

    // Cidade/estado/cep: prefere o do cliente; depois inline da venda; depois shipping_address; fallback pro da loja
    const cityRaw = customer?.city || sale.customer_city || shipAddr.city || store?.city || "";
    const stateRaw = customer?.state || sale.customer_state || shipAddr.state || shipAddr.province_code || store?.state || "";
    const zipRaw = customer?.cep || sale.customer_cep || shipAddr.cep || shipAddr.zip || store?.cep || "";
    const ct = cityRaw ? await hashIfPresent(normalizeCity(cityRaw)) : undefined;
    const st = stateRaw ? await hashIfPresent(normalizeState(stateRaw)) : undefined;
    const zp = zipRaw ? await hashIfPresent(normalizeZip(zipRaw)) : undefined;
    const co = await hashIfPresent("br");

    const ge = customer?.gender ? await hashIfPresent(String(customer.gender).trim().toLowerCase().charAt(0)) : undefined;

    const userData: Record<string, unknown> = {
      ph: ph ? [ph] : undefined,
      em: em ? [em] : undefined,
      fn: fn ? [fn] : undefined,
      ln: ln ? [ln] : undefined,
      ct: ct ? [ct] : undefined,
      st: st ? [st] : undefined,
      zp: zp ? [zp] : undefined,
      country: co ? [co] : undefined,
      ge: ge ? [ge] : undefined,
      external_id: externalId ? [externalId] : undefined,
      // Agente de usuário genérico (Meta exige presença na CAPI)
      client_user_agent: "Mozilla/5.0 (PDV Banana Calçados Offline)",
    };
    Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

    // 5) Monta o payload
    const eventId = `pos_purchase_${saleId}`;
    const eventTime = sale.paid_at
      ? Math.floor(new Date(sale.paid_at).getTime() / 1000)
      : Math.floor(new Date(sale.created_at).getTime() / 1000);

    const storeName = store?.name || "loja_fisica";
    const eventSourceUrl = `https://bananacalcados.com.br/loja/${encodeURIComponent(storeName.toLowerCase().replace(/\s+/g, "-"))}`;

    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTime,
          event_id: eventId,
          action_source: "physical_store",
          event_source_url: eventSourceUrl,
          user_data: userData,
          custom_data: {
            currency: "BRL",
            value: Number(value.toFixed(2)),
            order_id: saleId,
            // Identifica a loja física pra atribuição
            content_category: storeName,
          },
        },
      ],
    };

    if (TEST_CODE) (payload as any).test_event_code = TEST_CODE;

    // 6) Envia pra Meta
    const url = `https://graph.facebook.com/v21.0/${DATASET_ID}/events?access_token=${encodeURIComponent(META_TOKEN)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const respJson: any = await resp.json().catch(() => ({}));

    // 7) Atualiza log
    await supabase.from("meta_capi_offline_log").upsert({
      sale_id: saleId,
      event_name: "Purchase",
      event_id: eventId,
      dataset_id: DATASET_ID,
      test_event_code: TEST_CODE || null,
      status: resp.ok ? "sent" : "error",
      http_status: resp.status,
      meta_response: respJson,
      error_message: resp.ok ? null : (respJson?.error?.message || `HTTP ${resp.status}`),
      sent_at: new Date().toISOString(),
      payload_summary: {
        has_phone: !!ph,
        has_email: !!em,
        has_name: !!fn,
        has_external_id: !!externalId,
        has_city: !!ct,
        has_state: !!st,
        value,
        store_name: storeName,
      },
    }, { onConflict: "sale_id,event_name" });

    return new Response(
      JSON.stringify({
        ok: resp.ok,
        status: resp.status,
        event_id: eventId,
        test_event_code_applied: !!TEST_CODE,
        match_quality: {
          has_phone: !!ph,
          has_email: !!em,
          has_name: !!fn,
          has_external_id: !!externalId,
          has_city: !!ct,
          has_state: !!st,
        },
        meta_response: respJson,
      }),
      {
        status: resp.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[meta-capi-offline] error:", message);

    if (saleId) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await supabase.from("meta_capi_offline_log").upsert({
          sale_id: saleId,
          event_name: "Purchase",
          event_id: `error_${saleId}`,
          dataset_id: DATASET_ID,
          status: "error",
          error_message: message,
        }, { onConflict: "sale_id,event_name" });
      } catch (_) { /* ignore log error */ }
    }

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
