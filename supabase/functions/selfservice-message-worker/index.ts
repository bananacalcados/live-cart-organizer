// Worker da fila de mensagens automáticas do modo whatsapp_autoatendimento.
//
// Drena public.selfservice_message_queue respeitando:
// - intervalo mínimo de 4 s entre mensagens da MESMA instância (portão atômico
//   selfservice_instance_gate); instâncias diferentes não esperam entre si;
// - retry com backoff (30 s, 2 min, 10 min, 30 min) — timeout/erro do provedor
//   NUNCA descarta a mensagem: ela volta para a fila; só vira 'failed' após a
//   5ª tentativa, e aí aparece o alerta de reenvio na Central da Live;
// - idempotência pela message_key (pedido + tipo): o retry nunca duplica envio,
//   porque a linha só sai da fila quando o provedor confirma.
//
// É chamado (fire-and-forget) logo após cada enqueue e se auto-chama enquanto
// houver trabalho pendente — sem cron novo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const digits = (s: string) => String(s || "").replace(/\D/g, "");
const BACKOFF_S = [30, 120, 600, 1800]; // após a 5ª tentativa → failed
const MAX_ATTEMPTS = 5;
const MIN_INTERVAL_MS = 4000;
const BUDGET_MS = 50_000;

function extractMid(d: any): string | null {
  const c = d?.messageId ?? d?.data?.messageId ?? d?.data?.messageid ?? d?.data?.id ?? d?.data?.message?.messageid ?? d?.messages?.[0]?.id ?? d?.data?.messages?.[0]?.id ?? null;
  return c != null ? String(c) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${SB_KEY}` && !(await isAuthorizedCron(req))) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(SB_URL, SB_KEY);
  const start = Date.now();

  /** Envia uma mensagem pelo provider real da instância e grava no histórico do chat. */
  async function sendOne(row: any): Promise<string | null> {
    const p = row.payload || {};
    const text = String(p.text || "");
    const copyCode = p.copy_code ? String(p.copy_code) : undefined;
    const { data: num } = await sb.from("whatsapp_numbers").select("id, provider, is_active").eq("id", row.whatsapp_number_id).maybeSingle();
    if (!num || !(num as any).is_active) throw new Error("Instância oficial inativa");
    const provider = String((num as any).provider || "");
    const to = digits(row.phone).startsWith("55") ? digits(row.phone) : "55" + digits(row.phone);
    const headers = { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", "x-force-instance": "true" };
    let fn: string; let payload: Record<string, unknown>; let stored = text;
    if (copyCode && provider === "uazapi") {
      fn = "uazapi-send-buttons";
      payload = { phone: to, message: text, buttons: [{ id: "copy_pix", title: "Copiar código PIX", copyCode }], whatsapp_number_id: row.whatsapp_number_id };
      stored = `${text}\n\n[Botão: Copiar código PIX]\n[PIX_CODE:${copyCode}]`;
    } else if (provider === "meta") {
      fn = "meta-whatsapp-send"; payload = { phone: to, message: text, type: "text", whatsapp_number_id: row.whatsapp_number_id };
    } else {
      fn = provider === "wasender" ? "wasender-send-message" : provider === "uazapi" ? "uazapi-send-message" : "zapi-send-message";
      payload = { phone: to, message: text, whatsapp_number_id: row.whatsapp_number_id, linkPreview: false };
    }
    const r = await fetch(`${SB_URL}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || (d as any)?.error || (d as any)?.success === false) throw new Error(`[${r.status}] ${JSON.stringify(d).slice(0, 300)}`);
    const mid = extractMid(d);
    await sb.from("whatsapp_messages").insert({ phone: to, message: stored.slice(0, 4000), direction: "outgoing", status: "sent", media_type: "text", whatsapp_number_id: row.whatsapp_number_id, message_id: mid });
    return mid;
  }

  let processed = 0;
  while (Date.now() - start < BUDGET_MS) {
    const { data: rows, error } = await sb.rpc("selfservice_queue_claim", { p_limit: 20 });
    if (error) { console.error("[ss-worker] claim", error); break; }
    if (!rows?.length) break;

    for (const row of rows as any[]) {
      // Portão de ritmo: se a instância enviou há menos de 4 s, devolve a
      // mensagem para a fila (sem contar tentativa) e segue para outra instância.
      const { data: gate } = await sb.rpc("selfservice_instance_gate", {
        p_number_id: row.whatsapp_number_id ? String(row.whatsapp_number_id) : "sem-instancia",
        p_min_ms: MIN_INTERVAL_MS,
      });
      if (!gate) {
        await sb.from("selfservice_message_queue")
          .update({ status: "pending", next_attempt_at: new Date(Date.now() + MIN_INTERVAL_MS).toISOString() })
          .eq("id", row.id);
        continue;
      }
      try {
        const mid = await sendOne(row);
        processed += 1;
        await sb.from("selfservice_message_queue")
          .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null, payload: { ...(row.payload || {}), message_id: mid } })
          .eq("id", row.id);
        // O cronômetro do cashback (10% em 20 min) começa no envio REAL do link.
        if (row.kind === "cart_link" && mid && Array.isArray(row.payload?.order_ids) && row.payload.order_ids.length) {
          const { error: markErr } = await sb.rpc("selfservice_mark_cart_sent", { p_order_ids: row.payload.order_ids, p_message_id: mid });
          if (markErr) console.error("[ss-worker] mark_cart_sent", markErr);
        }
      } catch (e) {
        const attempts = Number(row.attempts || 0) + 1;
        const terminal = attempts >= MAX_ATTEMPTS;
        await sb.from("selfservice_message_queue")
          .update({
            status: terminal ? "failed" : "pending",
            attempts,
            next_attempt_at: new Date(Date.now() + BACKOFF_S[Math.min(attempts - 1, BACKOFF_S.length - 1)] * 1000).toISOString(),
            last_error: String(e).slice(0, 500),
          })
          .eq("id", row.id);
      }
    }

    // Ainda há algo vencido (ou vencendo logo por causa do ritmo)? Continua.
    const soon = new Date(Date.now() + MIN_INTERVAL_MS + 1000).toISOString();
    const { count } = await sb.from("selfservice_message_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending").lte("next_attempt_at", soon);
    if (!count) break;
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS + 500));
  }

  // Estourou o tempo com trabalho restante: auto-chama (fire-and-forget).
  const { count: left } = await sb.from("selfservice_message_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("next_attempt_at", new Date(Date.now() + 60_000).toISOString());
  if (left) {
    fetch(`${SB_URL}/functions/v1/selfservice-message-worker`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
  }
  return json({ ok: true, processed, remaining: left || 0 });
});
