// lead-notify-pdv
// Ao captar um lead qualificado no Typebot, envia a primeira mensagem pela
// instância do PDV configurada no typebot. Isso abre a conversa no chat do PDV
// (whatsapp_messages) com a etiqueta "Lead Crediário" em chat_contacts.
//
// Respeita: bloqueados / opt-out "PARAR" (blocked-guard), horário de silêncio
// (enfileira em automation_message_queue para o próximo horário permitido) e
// só usa instâncias não-oficiais (uazapi/wasender/zapi) — nunca Meta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBlockedSuffixes, isBlocked } from "../_shared/blocked-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const LEAD_TAG = "Lead Crediário";
const DEFAULT_MESSAGE =
  "Oi {nome}! 👋 Recebemos seu cadastro para o crediário da Banana Calçados. Em instantes uma vendedora fala com você por aqui.";

function spHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(d)) % 24;
}
function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
function nextAllowedAfterQuiet(end: number): Date {
  const now = new Date();
  for (let i = 0; i <= 48; i++) {
    const cand = new Date(now.getTime() + i * 30 * 60 * 1000);
    if (spHour(cand) === end) return cand;
  }
  return new Date(now.getTime() + 60 * 60 * 1000);
}
async function readSetting(supabase: any, key: string, fallback: number): Promise<number> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
    const n = Number(data?.value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch { return fallback; }
}

function fmtValue(def: any, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const t = def?.field_type;
  const opts: any[] = t === "yes_no" ? [{ label: "Sim", value: "sim" }, { label: "Não", value: "nao" }] : (Array.isArray(def?.options) ? def.options : []);
  const labelOf = (v: unknown) => opts.find((o) => o.value === String(v))?.label ?? String(v);
  if (t === "money") { const n = Number(value); return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : String(value); }
  if (t === "cpf") { const d = String(value).replace(/\D/g, ""); return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : String(value); }
  if (t === "select" || t === "yes_no") return labelOf(value);
  if (t === "multiselect" || Array.isArray(value)) return (Array.isArray(value) ? value : [value]).map(labelOf).join(", ");
  return String(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Chamada interna (event-lead-capture) ou operador logado (reenvio manual).
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  let internal = token === serviceKey;
  if (!internal) {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    internal = true;
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const leadId = typeof body?.lead_id === "string" ? body.lead_id : null;
    if (!leadId) return json({ error: "lead_id required" }, 400);

    const { data: lead } = await supabase
      .from("event_leads")
      .select("id, name, phone, typebot_id, custom_fields, disqualified, notified_at")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) return json({ error: "lead not found" }, 404);
    if (lead.disqualified) return json({ skipped: "disqualified" });
    const typebotId = body?.typebot_id || lead.typebot_id;
    if (!typebotId) return json({ skipped: "no_typebot" });
    if (lead.notified_at && !body?.force) return json({ skipped: "already_notified" });

    const { data: tb } = await supabase
      .from("event_typebots")
      .select("id, name, notify_enabled, notify_wa_number_id, notify_store_id, notify_message")
      .eq("id", typebotId)
      .maybeSingle();
    if (!tb?.notify_enabled || !tb.notify_wa_number_id) return json({ skipped: "notify_disabled" });

    const { data: num } = await supabase
      .from("whatsapp_numbers")
      .select("id, provider, is_active, label")
      .eq("id", tb.notify_wa_number_id)
      .maybeSingle();
    const provider = String(num?.provider || "");
    if (!num || !num.is_active || !["uazapi", "wasender", "zapi"].includes(provider)) {
      await supabase.from("event_leads").update({ notify_status: "failed", notify_error: "instância inválida/inativa ou oficial Meta" }).eq("id", lead.id);
      return json({ error: "invalid_instance" }, 400);
    }

    const phone = String(lead.phone || "").replace(/\D/g, "");
    if (phone.length < 12) {
      await supabase.from("event_leads").update({ notify_status: "failed", notify_error: "telefone inválido" }).eq("id", lead.id);
      return json({ error: "invalid_phone" }, 400);
    }

    // Bloqueados / opt-out "PARAR" — nunca envia.
    const blocked = await loadBlockedSuffixes(supabase as any);
    if (isBlocked(blocked, phone)) {
      await supabase.from("event_leads").update({ notify_status: "blocked", notify_error: "contato bloqueado ou descadastrado" }).eq("id", lead.id);
      return json({ skipped: "blocked" });
    }

    // Renderiza a mensagem com {nome}, {primeiro_nome} e {chave_do_campo}.
    const cf: Record<string, unknown> = (lead.custom_fields as any) || {};
    const { data: defs } = await supabase.from("lead_field_definitions").select("key, field_type, options");
    const defByKey = new Map((defs || []).map((d: any) => [d.key, d]));
    const firstName = String(lead.name || "").trim().split(/\s+/)[0] || "";
    const template = (tb.notify_message && tb.notify_message.trim()) ? tb.notify_message : DEFAULT_MESSAGE;
    const text = template
      .replace(/\{nome\}/g, String(lead.name || "").trim())
      .replace(/\{primeiro_nome\}/g, firstName)
      .replace(/\{([a-z][a-z0-9_]*)\}/g, (m, k) => (k in cf ? fmtValue(defByKey.get(k), cf[k]) : m))
      .trim()
      .slice(0, 4000);

    // Etiqueta na conversa (chat_contacts.tags) — aparece no chat do PDV.
    try {
      const { data: contact } = await supabase.from("chat_contacts").select("id, tags, display_name").eq("phone", phone).maybeSingle();
      const tags: string[] = Array.isArray(contact?.tags) ? contact!.tags : [];
      if (!tags.includes(LEAD_TAG)) tags.push(LEAD_TAG);
      if (contact) {
        await supabase.from("chat_contacts").update({ tags, display_name: contact.display_name || lead.name, updated_at: new Date().toISOString() }).eq("id", contact.id);
      } else {
        await supabase.from("chat_contacts").insert({ phone, tags, display_name: lead.name });
      }
    } catch (e) {
      console.warn("[lead-notify-pdv] tag error:", e);
    }

    // Horário de silêncio → agenda na fila anti-spam para o próximo horário permitido.
    const quietStart = await readSetting(supabase, "automation_quiet_hours_start", 22);
    const quietEnd = await readSetting(supabase, "automation_quiet_hours_end", 8);
    if (isQuietHour(spHour(), quietStart, quietEnd)) {
      const when = nextAllowedAfterQuiet(quietEnd);
      const { error: qErr } = await supabase.from("automation_message_queue").insert({
        phone,
        payload: { kind: "text", message: text },
        whatsapp_number_id: num.id,
        recipient_data: { name: lead.name, source: "lead_notify_pdv", lead_id: lead.id, typebot_id: tb.id },
        status: "pending",
        scheduled_at: when.toISOString(),
      });
      if (qErr) {
        await supabase.from("event_leads").update({ notify_status: "failed", notify_error: qErr.message.slice(0, 300) }).eq("id", lead.id);
        return json({ error: qErr.message }, 500);
      }
      await supabase.from("event_leads").update({ notify_status: "queued", notify_error: null, notified_at: new Date().toISOString() }).eq("id", lead.id);
      return json({ success: true, queued: true, scheduled_at: when.toISOString() });
    }

    // Envio imediato pela instância configurada.
    const headers = { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", "x-force-instance": "true" };
    const sendResp = await fetch(`${supabaseUrl}/functions/v1/${provider}-send-message`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, message: text, whatsapp_number_id: num.id }),
    });
    const sendResult: any = await sendResp.json().catch(() => ({}));
    if (!sendResp.ok || sendResult?.error) {
      const err = String(sendResult?.message || sendResult?.error || `HTTP ${sendResp.status}`).slice(0, 300);
      console.error("[lead-notify-pdv] send failed:", err, sendResult);
      await supabase.from("event_leads").update({ notify_status: "failed", notify_error: err }).eq("id", lead.id);
      return json({ error: err }, 502);
    }

    await supabase.from("whatsapp_messages").insert({
      phone,
      message: text,
      direction: "outgoing",
      status: "sent",
      media_type: "text",
      whatsapp_number_id: num.id,
      message_id: sendResult?.messageId || null,
    });
    await supabase.from("event_leads").update({ notify_status: "sent", notify_error: null, notified_at: new Date().toISOString() }).eq("id", lead.id);

    return json({ success: true, via: num.label || provider, phone });
  } catch (e) {
    console.error("[lead-notify-pdv] error:", e);
    return json({ error: String(e) }, 500);
  }
});
