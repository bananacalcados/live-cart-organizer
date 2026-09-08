// deno-lint-ignore-file no-explicit-any
// Edge: contact-erase
// "EXCLUIR CONTATO": apaga um contato de TODAS as bases de contato/lead/CRM/chat
// e registra um opt-out permanente para que nenhuma automação ou disparo em massa
// volte a alcançá-lo (mesmo que algum sync recrie o cadastro).
//
// O que NÃO é apagado (registros contábeis/fiscais/operacionais): pos_sales, orders,
// fiscal_documents, chargebacks, expedição, boletos, crediário, cashback/pontos.
// Quando o cadastro não pode ser apagado por vínculo com vendas, ele é anonimizado
// (telefone/handle removidos) para sair de qualquer segmentação.
//
// Body: { phone: string, instagram_handle?: string, reason?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Gera todas as variantes usuais de um telefone BR (com/sem 55, com/sem 9º dígito, com +). */
function phoneVariants(raw: string): { variants: string[]; key: string | null; suffix8: string | null; isJid: boolean } {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { variants: [], key: null, suffix8: null, isJid: false };
  // IDs do Instagram/Messenger ou JIDs de grupo: só a forma exata.
  if (trimmed.includes("@") || trimmed.includes("-") || /^120\d+$/.test(trimmed)) {
    return { variants: [trimmed], key: null, suffix8: null, isJid: true };
  }
  let d = trimmed.replace(/\D/g, "");
  if (!d) return { variants: [trimmed], key: null, suffix8: null, isJid: true };
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  // d = DDD + número (10 ou 11 dígitos)
  const ddd = d.slice(0, 2);
  const local = d.slice(2);
  const suffix8 = local.slice(-8);
  const key = `${ddd}${suffix8}`;
  const set = new Set<string>();
  for (const l of [suffix8, `9${suffix8}`]) {
    set.add(`55${ddd}${l}`);
    set.add(`${ddd}${l}`);
    set.add(`+55${ddd}${l}`);
  }
  set.add(trimmed);
  set.add(d);
  return { variants: [...set], key, suffix8, isJid: false };
}

type Target = { table: string; col: string; mode?: "eq" | "suffix8" | "key"; anonymize?: Record<string, unknown> };

// Tabelas onde o contato é apagado por telefone (todas as variantes).
const PHONE_TARGETS: Target[] = [
  // Chat / WhatsApp
  { table: "whatsapp_messages", col: "phone" },
  { table: "whatsapp_messages_archive", col: "phone" },
  { table: "chat_contacts", col: "phone" },
  { table: "chat_finished_conversations", col: "phone" },
  { table: "chat_assignments", col: "phone" },
  { table: "chat_conversation_assignments", col: "phone" },
  { table: "chat_seller_assignments", col: "phone" },
  { table: "chat_archived_conversations", col: "phone" },
  { table: "chat_awaiting_payment", col: "phone" },
  { table: "chat_nps_surveys", col: "phone" },
  { table: "chat_payment_followups", col: "phone" },
  { table: "chat_scheduled_followups", col: "phone" },
  { table: "chat_conversation_lanes", col: "phone_key", mode: "key" },
  { table: "event_contact_lanes", col: "phone_key", mode: "key" },
  { table: "event_archived_conversations", col: "phone" },
  { table: "scheduled_messages", col: "phone" },
  { table: "product_wait_notifications", col: "phone" },
  { table: "ai_conversation_logs", col: "phone" },
  { table: "ai_assistance_requests", col: "customer_phone" },
  { table: "support_tickets", col: "customer_phone" },
  // Leads
  { table: "event_leads", col: "phone" },
  { table: "event_leads", col: "phone_suffix", mode: "suffix8" },
  { table: "ad_leads", col: "phone" },
  { table: "campaign_leads", col: "phone" },
  { table: "link_page_leads", col: "phone" },
  { table: "lp_leads", col: "phone" },
  { table: "catalog_lead_registrations", col: "whatsapp" },
  { table: "customer_registrations", col: "whatsapp" },
  { table: "vip_orphan_contacts", col: "phone" },
  { table: "vip_orphan_contacts", col: "phone_suffix8", mode: "suffix8" },
  { table: "live_member_sessions", col: "phone" },
  { table: "live_phone_verifications", col: "phone" },
  { table: "live_whatsapp_clicks", col: "phone" },
  { table: "live_whatsapp_clicks", col: "real_phone" },
  { table: "live_whatsapp_clicks", col: "entered_phone" },
  { table: "customer_access_codes", col: "phone" },
  { table: "review_tokens", col: "customer_phone" },
  { table: "referrals", col: "friend_phone" },
  // Marketing / disparos / automações
  { table: "marketing_contacts", col: "phone" },
  { table: "dispatch_recipients", col: "phone" },
  { table: "mass_dispatch_targets", col: "phone" },
  { table: "mass_dispatch_targets", col: "phone_suffix8", mode: "suffix8" },
  { table: "meta_message_queue", col: "phone" },
  { table: "meta_attribution_identities", col: "phone" },
  { table: "meta_capi_lead_events", col: "phone" },
  { table: "automation_ai_sessions", col: "phone" },
  { table: "automation_contact_pacing", col: "phone" },
  { table: "automation_dispatch_sent", col: "phone" },
  { table: "automation_message_queue", col: "phone" },
  { table: "automation_pending_replies", col: "phone" },
  { table: "automation_pos_followups", col: "customer_phone" },
  { table: "pos_seller_tasks", col: "customer_phone" },
  { table: "pos_task_contacts", col: "customer_phone" },
  // Cadastros (se houver vínculo com vendas, cai no anonimizar)
  { table: "customers", col: "whatsapp", anonymize: { whatsapp: null, instagram_handle: null } },
  { table: "pos_customers", col: "whatsapp", anonymize: { whatsapp: null, previous_whatsapp_numbers: [] } },
  { table: "customers_unified", col: "phone_e164", anonymize: { phone_e164: null, phone_suffix8: null, previous_phones: [], instagram_handle: null, instagram_user_id: null, email: null } },
  { table: "customers_unified", col: "phone_suffix8", mode: "suffix8", anonymize: { phone_e164: null, phone_suffix8: null, previous_phones: [], instagram_handle: null, instagram_user_id: null, email: null } },
  // Importações externas
  { table: "zoppy_customers", col: "phone" },
  { table: "ravena_customers", col: "phone" },
];

// Tabelas onde o contato é apagado pelo @ do Instagram.
const IG_TARGETS: Target[] = [
  { table: "customers", col: "instagram_handle", anonymize: { whatsapp: null, instagram_handle: null } },
  { table: "customers_unified", col: "instagram_handle", anonymize: { phone_e164: null, phone_suffix8: null, previous_phones: [], instagram_handle: null, instagram_user_id: null, email: null } },
  { table: "event_leads", col: "instagram" },
  { table: "lp_leads", col: "instagram" },
  { table: "campaign_leads", col: "instagram" },
  { table: "marketing_contacts", col: "instagram" },
  { table: "catalog_lead_registrations", col: "instagram_handle" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt ? await supabase.auth.getUser(jwt) : { data: null as any };
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone || "").trim();
    const igRaw = String(body.instagram_handle || "").trim().replace(/^@/, "").toLowerCase();
    const reason = String(body.reason || "excluido_manual").slice(0, 200);
    if (!phone && !igRaw) return json({ error: "phone ou instagram_handle obrigatório" }, 400);

    const pv = phoneVariants(phone);
    const igVariants = igRaw ? [igRaw, `@${igRaw}`] : [];

    const report: Record<string, number> = {};
    const anonymized: Record<string, number> = {};
    const failures: Record<string, string> = {};

    const run = async (t: Target, values: string[]) => {
      if (!values.length) return;
      const label = `${t.table}.${t.col}`;
      const { data, error } = await supabase.from(t.table).delete().in(t.col, values).select("id");
      if (!error) {
        if (data?.length) report[label] = (report[label] || 0) + data.length;
        return;
      }
      // Vínculo com vendas/pedidos (FK) → anonimiza em vez de apagar.
      if (t.anonymize) {
        const { data: up, error: e2 } = await supabase.from(t.table).update(t.anonymize).in(t.col, values).select("id");
        if (!e2) { if (up?.length) anonymized[label] = (anonymized[label] || 0) + up.length; return; }
        failures[label] = e2.message;
        return;
      }
      // Tabela inexistente/sem coluna: ignora silenciosamente; outros erros: reporta.
      if (!/does not exist|relation|column/i.test(error.message)) failures[label] = error.message;
    };

    if (phone) {
      for (const t of PHONE_TARGETS) {
        if (t.mode === "suffix8") { if (pv.suffix8) await run(t, [pv.suffix8]); continue; }
        if (t.mode === "key") { if (pv.key) await run(t, [pv.key]); continue; }
        await run(t, pv.variants);
      }
    }
    for (const t of IG_TARGETS) await run(t, igVariants);

    // Opt-out permanente (todas as instâncias) — garante que disparos/automações
    // nunca mais alcancem este número, mesmo que um sync recrie o cadastro.
    if (phone && !pv.isJid && pv.key) {
      const e164 = pv.variants.find((v) => /^55\d{2}9\d{8}$/.test(v)) || pv.variants[0];
      await supabase.from("automation_opt_outs").delete().eq("phone_key", pv.key);
      await supabase.from("automation_opt_outs").insert({
        phone: e164, phone_key: pv.key, source: "contact_erase",
        keyword: `${reason} por ${auth.user.email || auth.user.id}`.slice(0, 200),
        whatsapp_number_id: null,
      });
    }

    const total = Object.values(report).reduce((a, b) => a + b, 0);
    const totalAnon = Object.values(anonymized).reduce((a, b) => a + b, 0);
    console.log(`[contact-erase] ${phone || igRaw} by ${auth.user.email}: deleted=${total} anonymized=${totalAnon}`, failures);
    return json({ ok: true, deleted: total, anonymized: totalAnon, detail: report, anonymized_detail: anonymized, failures });
  } catch (e: any) {
    console.error("[contact-erase]", e);
    return json({ error: e?.message || "internal_error" }, 500);
  }
});
