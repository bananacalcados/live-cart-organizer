// Backfill de eventos Purchase OFFLINE pra Meta CAPI — VERSÃO INLINE
// Envia direto pra Meta CAPI (sem invocar outra edge function),
// evitando rate limit do Supabase Edge Functions.
//
// Modos:
//   - dry_run=true  → conta vendas, mostra amostra, NÃO envia
//   - dry_run=false → envia em lotes pra Meta (até 1000 eventos por request)
//
// Auth: Bearer SERVICE_ROLE_KEY OU header X-Internal-Secret = META_CAPI_INTERNAL_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const DATASET_ID = "1346445220878187"; // Visita Loja Física
const META_BATCH_SIZE = 500;            // eventos por POST pra Meta (max 1000)
const PAUSE_MS = 1200;                  // pausa entre POSTs pra Meta

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const normPhone = (raw: string) => {
  const d = (raw || "").replace(/[^0-9]/g, "");
  if (!d) return "";
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
};
const normEmail = (s: string) => (s || "").trim().toLowerCase();
const normName = (s: string) => stripAccents((s || "").trim().toLowerCase());
const normCity = (s: string) => stripAccents((s || "").toLowerCase()).replace(/[^a-z0-9]/g, "");
const normState = (s: string) => stripAccents((s || "").trim().toLowerCase()).replace(/[^a-z]/g, "");
const normZip = (s: string) => (s || "").replace(/[^0-9]/g, "");
const normCpf = (s: string) => (s || "").replace(/[^0-9]/g, "");

function splitName(full: string | null | undefined) {
  if (!full) return { first: undefined, last: undefined };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: undefined, last: undefined };
  if (parts.length === 1) return { first: parts[0], last: undefined };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function hashIfPresent(raw: string | null | undefined) {
  if (!raw) return undefined;
  const t = String(raw).trim();
  if (!t) return undefined;
  return await sha256Hex(t);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const INTERNAL_SECRET = Deno.env.get("META_CAPI_INTERNAL_SECRET") || "";
  const META_TOKEN = Deno.env.get("META_OFFLINE_CAPI_TOKEN") || "";
  const TEST_CODE = Deno.env.get("META_OFFLINE_TEST_EVENT_CODE")?.trim() || undefined;

  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const internalHeader = req.headers.get("x-internal-secret") || "";
  const isAuthed =
    (SERVICE_ROLE_KEY && auth === SERVICE_ROLE_KEY) ||
    (INTERNAL_SECRET && internalHeader === INTERNAL_SECRET);
  if (!isAuthed) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!META_TOKEN) {
    return new Response(JSON.stringify({ error: "META_OFFLINE_CAPI_TOKEN not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(1, Math.min(365, Number(body?.days ?? 90)));
    const dryRun = body?.dry_run !== false;
    const limit = Math.max(1, Math.min(10000, Number(body?.limit ?? 5000)));
    const overrideTestCode: string | undefined = body?.test_event_code?.trim() || TEST_CODE;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE_KEY);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // 1) Vendas elegíveis — paginação manual em chunks de 1000 (limite PostgREST)
    const allSales: any[] = [];
    const PAGE = 1000;
    for (let offset = 0; offset < limit; offset += PAGE) {
      const upper = Math.min(offset + PAGE, limit) - 1;
      const { data, error } = await supabase
        .from("pos_sales")
        .select("id, total, status, created_at, paid_at, customer_id, store_id, customer_name, customer_phone")
        .in("status", ["paid", "completed"])
        .gte("created_at", cutoff)
        .gt("total", 0)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, upper);
      if (error) throw new Error(`pos_sales query (offset ${offset}): ${error.message}`);
      const chunk = data || [];
      allSales.push(...chunk);
      if (chunk.length < PAGE) break;
    }

    // 2) Já enviados/pendentes
    const saleIds = allSales.map((s) => s.id);
    const sentSet = new Set<string>();
    if (saleIds.length > 0) {
      // chunk em 1000 pra evitar limite de IN
      for (let i = 0; i < saleIds.length; i += 1000) {
        const chunk = saleIds.slice(i, i + 1000);
        const { data: ls } = await supabase
          .from("meta_capi_offline_log")
          .select("sale_id")
          .in("sale_id", chunk)
          .eq("event_name", "Purchase")
          .in("status", ["sent", "pending"]);
        (ls || []).forEach((r: any) => sentSet.add(r.sale_id));
      }
    }
    const pending = allSales.filter((s) => !sentSet.has(s.id));

    // 3) Carregar customers e stores em batch
    const customerIds = Array.from(new Set(pending.map((s) => s.customer_id).filter(Boolean)));
    const storeIds = Array.from(new Set(pending.map((s) => s.store_id).filter(Boolean)));

    const customersMap = new Map<string, any>();
    for (let i = 0; i < customerIds.length; i += 500) {
      const chunk = customerIds.slice(i, i + 500);
      const { data } = await supabase
        .from("pos_customers")
        .select("id, name, email, whatsapp, cpf, city, state, cep, gender")
        .in("id", chunk);
      (data || []).forEach((c: any) => customersMap.set(c.id, c));
    }
    const storesMap = new Map<string, any>();
    if (storeIds.length > 0) {
      const { data } = await supabase
        .from("pos_stores")
        .select("id, name, city, state, cep")
        .in("id", storeIds);
      (data || []).forEach((s: any) => storesMap.set(s.id, s));
    }

    const stats = {
      window_days: days,
      cutoff_date: cutoff,
      total_sales_in_window: allSales.length,
      already_sent_or_pending: sentSet.size,
      eligible_to_send: pending.length,
      total_value_brl: Number(pending.reduce((acc, s) => acc + Number(s.total || 0), 0).toFixed(2)),
    };

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, mode: "dry_run", stats }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4) Construir eventos e log entries
    type BuiltEvent = { sale_id: string; event_id: string; event: any; logEntry: any };
    const built: BuiltEvent[] = [];
    let skippedNoIdent = 0;

    for (const sale of pending) {
      const customer = sale.customer_id ? customersMap.get(sale.customer_id) : null;
      const store = sale.store_id ? storesMap.get(sale.store_id) : null;

      const phoneRaw = customer?.whatsapp || sale.customer_phone || "";
      const emailRaw = customer?.email || "";
      const cpfRaw = customer?.cpf || "";
      const nameRaw = customer?.name || sale.customer_name || "";

      if (!phoneRaw && !emailRaw && !cpfRaw) {
        skippedNoIdent++;
        await supabase.from("meta_capi_offline_log").upsert({
          sale_id: sale.id,
          event_name: "Purchase",
          event_id: `skipped_${sale.id}`,
          dataset_id: DATASET_ID,
          status: "skipped",
          error_message: "no customer identifiers",
        }, { onConflict: "sale_id,event_name" });
        continue;
      }

      const phoneNorm = normPhone(phoneRaw);
      const ph = phoneNorm ? await sha256Hex(phoneNorm) : undefined;
      const em = emailRaw ? await sha256Hex(normEmail(emailRaw)) : undefined;
      const externalId = cpfRaw
        ? await sha256Hex(normCpf(cpfRaw))
        : (sale.customer_id ? await sha256Hex(sale.customer_id) : undefined);
      const { first, last } = splitName(nameRaw);
      const fn = first ? await hashIfPresent(normName(first)) : undefined;
      const ln = last ? await hashIfPresent(normName(last)) : undefined;
      const cityRaw = customer?.city || store?.city || "";
      const stateRaw = customer?.state || store?.state || "";
      const zipRaw = customer?.cep || store?.cep || "";
      const ct = cityRaw ? await hashIfPresent(normCity(cityRaw)) : undefined;
      const st = stateRaw ? await hashIfPresent(normState(stateRaw)) : undefined;
      const zp = zipRaw ? await hashIfPresent(normZip(zipRaw)) : undefined;
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
        client_user_agent: "Mozilla/5.0 (PDV Banana Calçados Offline)",
      };
      Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

      const eventId = `pos_purchase_${sale.id}`;
      const eventTime = sale.paid_at
        ? Math.floor(new Date(sale.paid_at).getTime() / 1000)
        : Math.floor(new Date(sale.created_at).getTime() / 1000);
      const storeName = store?.name || "loja_fisica";
      const eventSourceUrl = `https://bananacalcados.com.br/loja/${encodeURIComponent(storeName.toLowerCase().replace(/\s+/g, "-"))}`;
      const value = Number(Number(sale.total || 0).toFixed(2));

      built.push({
        sale_id: sale.id,
        event_id: eventId,
        event: {
          event_name: "Purchase",
          event_time: eventTime,
          event_id: eventId,
          action_source: "physical_store",
          event_source_url: eventSourceUrl,
          user_data: userData,
          custom_data: {
            currency: "BRL",
            value,
            order_id: sale.id,
            content_category: storeName,
          },
        },
        logEntry: {
          sale_id: sale.id,
          event_name: "Purchase",
          event_id: eventId,
          dataset_id: DATASET_ID,
          test_event_code: overrideTestCode || null,
          payload_summary: {
            has_phone: !!ph, has_email: !!em, has_name: !!fn, has_external_id: !!externalId,
            has_city: !!ct, has_state: !!st, value, store_name: storeName,
          },
        },
      });
    }

    // 5) Enviar pra Meta em lotes
    const results = { sent: 0, errors: 0, skipped: skippedNoIdent, error_messages: [] as string[] };
    const url = `https://graph.facebook.com/v21.0/${DATASET_ID}/events?access_token=${encodeURIComponent(META_TOKEN)}`;

    for (let i = 0; i < built.length; i += META_BATCH_SIZE) {
      const batch = built.slice(i, i + META_BATCH_SIZE);
      const payload: any = { data: batch.map((b) => b.event) };
      if (overrideTestCode) payload.test_event_code = overrideTestCode;

      let resp: Response;
      let respJson: any = {};
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        respJson = await resp.json().catch(() => ({}));
      } catch (e) {
        results.errors += batch.length;
        if (results.error_messages.length < 10) {
          results.error_messages.push(`batch ${i}: ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }

      const ok = resp.ok && (respJson?.events_received ?? 0) > 0;
      const logRows = batch.map((b) => ({
        ...b.logEntry,
        status: ok ? "sent" : "error",
        http_status: resp.status,
        meta_response: respJson,
        error_message: ok ? null : (respJson?.error?.message || `HTTP ${resp.status}`),
        sent_at: new Date().toISOString(),
      }));
      // upsert em chunks de 500
      for (let k = 0; k < logRows.length; k += 500) {
        const chunk = logRows.slice(k, k + 500);
        await supabase.from("meta_capi_offline_log").upsert(chunk, { onConflict: "sale_id,event_name" });
      }

      if (ok) {
        results.sent += batch.length;
      } else {
        results.errors += batch.length;
        if (results.error_messages.length < 10) {
          results.error_messages.push(`batch ${i}: HTTP ${resp.status} - ${respJson?.error?.message || "unknown"}`);
        }
      }

      if (i + META_BATCH_SIZE < built.length) await sleep(PAUSE_MS);
    }

    return new Response(JSON.stringify({ ok: true, mode: "send_inline", stats, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backfill] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
