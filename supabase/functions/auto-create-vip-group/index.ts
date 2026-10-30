import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cria automaticamente um grupo reserva (standby) para uma campanha VIP,
 * SEMPRE pela instância da campanha (group_campaigns.whatsapp_number_id),
 * roteando pelo provedor (uazapi → uazapi-groups; Z-API → zapi-group-settings).
 * Chamado por cron-check-vip-groups e group-redirect-link (servidor, service role).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STANDBY_MAX_COUNT = 50;
const MIN_INTERVAL_MS = 30 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") || "";
  if (auth !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(supabaseUrl, serviceKey);

  const callFn = async (fn: string, body: Record<string, unknown>) => {
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data?.success !== false && !data?.error;
      return { ok, data, error: ok ? null : (data?.error || `http_${r.status}`) };
    } catch (e) {
      return { ok: false, data: null, error: String(e) };
    }
  };

  try {
    const { campaign_id } = await req.json().catch(() => ({}));
    if (!campaign_id) return json({ error: "campaign_id is required" }, 400);

    const { data: campaign, error: campErr } = await supabase
      .from("group_campaigns")
      .select("id, name, target_groups, whatsapp_number_id, group_name_template, group_photo_url, group_description, group_only_admins_send, group_only_admins_add, group_admin_phones, group_pin_message_text, group_pin_duration")
      .eq("id", campaign_id)
      .maybeSingle();
    if (campErr || !campaign) {
      console.error("[auto-create] campanha não encontrada", campErr);
      return json({ error: "Campaign not found" }, 404);
    }
    const c: any = campaign;
    if (!c.whatsapp_number_id) return json({ error: "Campanha sem instância de WhatsApp definida" }, 400);

    const { data: inst } = await supabase
      .from("whatsapp_numbers")
      .select("id, provider, zapi_instance_id, uazapi_instance_name, is_active")
      .eq("id", c.whatsapp_number_id)
      .maybeSingle();
    if (!inst) return json({ error: "Instância da campanha não encontrada" }, 400);
    const provider = inst.provider || "zapi";
    if (provider !== "uazapi" && provider !== "zapi") {
      return json({ error: `Criação automática não suportada para o provedor ${provider}` }, 400);
    }

    const targetIds: string[] = c.target_groups || [];
    const { data: groups } = targetIds.length
      ? await supabase.from("whatsapp_groups")
          .select("id, name, participant_count, is_active, is_full, invite_link, created_at")
          .in("id", targetIds)
      : { data: [] as any[] };

    // ── Proteções contra duplicidade ──
    const standby = (groups || []).find((g: any) => g.is_active !== false && !g.is_full && (g.participant_count || 0) < STANDBY_MAX_COUNT);
    if (standby) {
      return json({ success: true, skipped: true, reason: "standby_exists",
        group: { id: standby.id, name: standby.name, invite_link: standby.invite_link } });
    }
    const lastCreated = (groups || []).reduce((m: number, g: any) => Math.max(m, g.created_at ? Date.parse(g.created_at) : 0), 0);
    if (lastCreated && Date.now() - lastCreated < MIN_INTERVAL_MS) {
      return json({ success: true, skipped: true, reason: "created_less_than_30min_ago" });
    }

    // ── Nome sequencial: maior #n já usado + 1 ──
    const baseName = String(c.group_name_template || c.name || "VIP").replace(/\s*#\d+\s*$/, "").trim();
    let maxN = 0;
    for (const g of groups || []) {
      const m = String(g.name || "").match(/#(\d+)\s*$/);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    const newName = `${baseName} #${Math.max(maxN, (groups || []).length) + 1}`;

    const adminPhones: string[] = (c.group_admin_phones || []).map((p: string) => String(p).replace(/\D/g, "")).filter(Boolean);
    if (adminPhones.length === 0) {
      return json({ error: "Cadastre ao menos 1 telefone de admin na campanha para criar grupos automaticamente" }, 400);
    }

    // ── Criação ──
    let newJid: string | null = null;
    let inviteLink: string | null = null;
    if (provider === "uazapi") {
      const r = await callFn("uazapi-groups", { action: "create", name: newName, participants: adminPhones, whatsapp_number_id: inst.id });
      const d: any = r.data?.data || {};
      newJid = d?.group?.JID || d?.JID || d?.jid || d?.group?.jid || d?.id || null;
      if (!r.ok || !newJid) {
        console.error("[auto-create] falha ao criar grupo uazapi", r.error, r.data);
        return json({ error: "Failed to create group", details: r.data }, 500);
      }
    } else {
      const r = await callFn("zapi-group-settings", { action: "create", groupName: newName, phones: adminPhones, whatsapp_number_id: inst.id });
      newJid = r.data?.groupId || r.data?.data?.phone || r.data?.data?.groupId || null;
      inviteLink = r.data?.data?.invitationLink || null;
      if (!r.ok || !newJid) {
        console.error("[auto-create] falha ao criar grupo Z-API", r.error, r.data);
        return json({ error: "Failed to create group", details: r.data }, 500);
      }
    }
    console.log(`[auto-create] grupo "${newName}" criado (${provider}) jid=${newJid} campanha=${c.id}`);

    // Grava IMEDIATAMENTE (evita recriação se alguma configuração falhar)
    const instanceKey = provider === "zapi" ? (inst.zapi_instance_id || inst.id) : inst.id;
    const { data: newGroup, error: insErr } = await supabase.from("whatsapp_groups").insert({
      group_id: newJid, group_jid_base: String(newJid).split("@")[0].split("-")[0].replace(/\D/g, ""),
      name: newName, is_vip: false, is_active: true, is_admin: true,
      instance_id: instanceKey, participant_count: adminPhones.length + 1, max_participants: 1024,
      invite_link: inviteLink,
    }).select("id").single();
    if (insErr || !newGroup) {
      console.error("[auto-create] grupo criado no WhatsApp mas não salvo", insErr);
      return json({ error: "Group created on WhatsApp but failed to save to DB", group_id: newJid }, 500);
    }
    const updated = [...targetIds, newGroup.id];
    await supabase.from("group_campaigns").update({ target_groups: updated, total_groups: updated.length }).eq("id", c.id);

    // ── Configurações: ENFILEIRADAS na fila de ações de grupo (ritmo anti-ban) ──
    // A criação do grupo em si continua direta; nome/descrição/foto/permissões/
    // admins/pin são executados pelo group-admin-worker, uma ação por vez.
    const errors: string[] = [];
    const batch = `auto-create-${newGroup.id.slice(0, 8)}`;
    const queueRows: Record<string, unknown>[] = [];
    let seq = 0;
    const enqueue = (action_type: string, payload: Record<string, unknown>) => {
      queueRows.push({
        whatsapp_number_id: inst.id,
        group_db_id: newGroup.id,
        group_jid: newJid,
        group_name_snapshot: newName,
        campaign_id: c.id,
        action_type,
        payload,
        batch,
        requested_by: "system",
        seq: ++seq,
        status: "queued",
      });
    };
    if (c.group_description) enqueue("set_description", { description: c.group_description });
    if (c.group_photo_url) enqueue("set_photo", { photo_url: c.group_photo_url });
    enqueue("set_only_admins_send", { enabled: !!c.group_only_admins_send });
    enqueue("set_only_admins_add", { enabled: !!c.group_only_admins_add });
    for (const ph of adminPhones) enqueue("promote_admin", { phone: ph });
    if (c.group_pin_message_text) enqueue("pin_message", { text: c.group_pin_message_text, duration: c.group_pin_duration || "7_days" });
    if (queueRows.length > 0) {
      const { error: qErr } = await supabase.from("group_admin_actions").insert(queueRows);
      if (qErr) {
        console.error("[auto-create] falha ao enfileirar configurações", qErr);
        errors.push("fila de configuração: não gravada");
      } else {
        console.log(`[auto-create] ${queueRows.length} configurações enfileiradas para "${newName}" (lote ${batch})`);
      }
    }

    // Link de convite (leitura, continua direta)
    if (provider === "uazapi") {
      const inv = await callFn("uazapi-groups", { action: "inviteLink", groupJid: newJid, whatsapp_number_id: inst.id });
      const d: any = inv.data?.data || {};
      inviteLink = d?.InviteLink || d?.inviteLink || d?.invite_link || d?.link || d?.group?.invite_link || null;
      if (!inviteLink) errors.push("link de convite: não retornado");
    }
    if (inviteLink) await supabase.from("whatsapp_groups").update({ invite_link: inviteLink }).eq("id", newGroup.id);

    if (errors.length) console.warn(`[auto-create] grupo "${newName}" criado com ressalvas:`, errors);
    else console.log(`[auto-create] grupo "${newName}" criado; configurações na fila`);

    return json({ success: true, group: { id: newGroup.id, group_id: newJid, name: newName, invite_link: inviteLink }, queued_config_actions: queueRows.length, config_errors: errors });
  } catch (error) {
    console.error("[auto-create] erro:", error);
    return json({ error: "Internal server error", details: (error as Error).message }, 500);
  }
});
