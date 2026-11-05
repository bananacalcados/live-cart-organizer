import { withAccessLog } from "../_shared/withAccessLog.ts";
// Convites do catálogo cross-sell (auto após pagamento / manual pela equipe).
// Chamado pelo cron 'live-catalog-invites' (x-cron-secret) ou pela equipe logada (módulo Eventos) para acordar o envio manual.
// Nunca envia direto: enfileira na fila anti-spam do autoatendimento (selfservice_message_queue).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";
import { buildInviteText, catalogUrl, inviteName } from "./invite.ts";

const MODE = "whatsapp_autoatendimento";
const MAX_ATTEMPTS = 3;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(withAccessLog("live-catalog-invite", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SB_URL, SB_KEY);

  let authorized = await isAuthorizedCron(req);
  if (!authorized) {
    const auth = req.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ")) {
      const { data: u } = await sb.auth.getUser(auth.slice(7));
      if (u?.user) {
        const { data: ok } = await sb.rpc("has_module_access", { _user_id: u.user.id, _module: "events" });
        authorized = ok === true;
      }
    }
  }
  if (!authorized) return json({ error: "Unauthorized" }, 401);

  const { data: rows, error } = await sb.rpc("live_catalog_invites_claim", { p_limit: 20 });
  if (error) { console.error("[catalog-invite] claim", error); return json({ error: "claim_failed" }, 500); }

  const results: Record<string, string> = {};
  let wake = false;
  for (const inv of (rows || []) as any[]) {
    const fail = async (msg: string) => {
      const retry = Number(inv.attempts || 0) < MAX_ATTEMPTS;
      await sb.from("live_catalog_invites").update(retry
        ? { status: "scheduled", send_after: new Date(Date.now() + 120_000).toISOString(), error: msg }
        : { status: "failed", error: msg }).eq("id", inv.id).eq("status", "sending");
      results[inv.id] = retry ? `retry:${msg}` : `failed:${msg}`;
    };
    try {
      const { data: ev } = await sb.from("events").select("id, self_service_slug, operation_mode, catalog_enabled, catalog_auto_invite, whatsapp_number_id").eq("id", inv.event_id).maybeSingle();
      const E = ev as any;
      const skip = !E || E.operation_mode !== MODE ? "evento fora do modo autoatendimento"
        : !E.catalog_enabled ? "catálogo desligado"
        : inv.kind === "auto" && !E.catalog_auto_invite ? "convite automático desligado" : null;
      if (skip) {
        await sb.from("live_catalog_invites").update({ status: "skipped", error: skip }).eq("id", inv.id).eq("status", "sending");
        results[inv.id] = `skipped:${skip}`; continue;
      }

      // Link (cria/estende).
      const { data: link, error: le } = await sb.rpc("live_catalog_ensure_link", { p_event_id: E.id, p_phone_key: inv.phone_key, p_customer_id: inv.customer_id, p_order_id: inv.order_id });
      if (le || !link) { await fail(`link: ${le?.message || "falhou"}`); continue; }
      const L = link as any;
      const sourceOrder = L.source_order_id || inv.order_id || null;

      // Telefone/instância: igual à mensagem do novo carrinho.
      let access: any = null;
      if (sourceOrder) {
        const { data: accId } = await sb.rpc("selfservice_access_for_order", { p_order_id: sourceOrder });
        if (accId) access = (await sb.from("live_selfservice_accesses").select("confirmed_phone, confirmed_number_id").eq("id", accId).maybeSingle()).data;
      }
      const custId = L.customer_id || inv.customer_id || null;
      const cust = custId ? (await sb.from("customers").select("whatsapp, instagram_handle").eq("id", custId).maybeSingle()).data as any : null;
      const phone = access?.confirmed_phone || (inv.kind === "manual" ? inv.phone : null) || cust?.whatsapp || inv.phone || null;
      let numberId: string | null = access?.confirmed_number_id || null;
      if (!numberId) {
        const { data: wl } = await sb.from("live_whatsapp_links").select("whatsapp_number_id").eq("event_id", E.id).order("is_active", { ascending: false }).limit(1).maybeSingle();
        numberId = (wl as any)?.whatsapp_number_id || E.whatsapp_number_id || null;
      }
      const dig = String(phone || "").replace(/\D/g, "");
      if (dig.length < 10 || !numberId) { await fail("sem telefone ou instância"); continue; }

      let fullName: string | null = null;
      if (!cust?.instagram_handle) {
        const q = sourceOrder
          ? sb.from("customer_registrations").select("full_name").eq("order_id", sourceOrder)
          : sb.from("customer_registrations").select("full_name").like("whatsapp", `%${inv.phone_key}`);
        fullName = ((await q.order("created_at", { ascending: false }).limit(1).maybeSingle()).data as any)?.full_name ?? null;
      }
      const text = buildInviteText(inviteName(cust?.instagram_handle, fullName), catalogUrl(E.self_service_slug, L.token));
      const key = Number(inv.send_seq || 0) > 0 ? `catalog-invite:${inv.id}:${inv.send_seq}` : `catalog-invite:${inv.id}`;
      const { error: qe } = await sb.rpc("selfservice_queue_enqueue", {
        p_message_key: key, p_event_id: E.id, p_order_id: sourceOrder, p_kind: "catalog_invite",
        p_phone: phone, p_whatsapp_number_id: numberId, p_payload: { text, catalog_link_id: L.id, invite_id: inv.id },
      });
      if (qe) { await fail(`fila: ${qe.message}`); continue; }
      const now = new Date().toISOString();
      await sb.from("live_catalog_invites").update({ status: "sent", enqueued_at: now, sent_message_key: key, link_id: L.id, error: null }).eq("id", inv.id).eq("status", "sending");
      await sb.from("live_catalog_links").update({ invite_sent_at: now, invite_kind: inv.kind }).eq("id", L.id);
      results[inv.id] = "sent"; wake = true;
    } catch (e) {
      console.error("[catalog-invite]", inv.id, e);
      await fail(String((e as any)?.message || e).slice(0, 300));
    }
  }
  if (wake) {
    fetch(`${SB_URL}/functions/v1/selfservice-message-worker`, { method: "POST", headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  }
  return json({ ok: true, processed: Object.keys(results).length, results });
}));
