import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveUazapiCredentials,
  uazapiInstance,
  formatUazapiNumber,
} from "../_shared/uazapi-credentials.ts";
import { loadBlockedSuffixes, isBlocked } from "../_shared/blocked-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * vip-orphan-dispatch — disparo em massa para a base de órfãos de grupos VIP.
 *
 * Ações:
 *  - prepare: monta a lista de destinatários (mass_dispatch_targets) a partir de
 *    vip_orphan_contacts (status=orphan, não opt-out, filtros de grupo), remove
 *    bloqueados (blocked_contacts) e marca a campanha como "running".
 *  - process: envia um lote de destinatários pendentes com delays humanos,
 *    grava status/message_id e atualiza contadores. Retorna quantos restam.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { action, campaign_id, batch_size } = await req.json();
    if (!campaign_id) return json({ error: "campaign_id é obrigatório" }, 400);

    const { data: campaign, error: cErr } = await supabase
      .from("mass_dispatch_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .single();
    if (cErr || !campaign) return json({ error: "Campanha não encontrada" }, 404);

    // ── PREPARE ───────────────────────────────────────────────────────
    if (action === "prepare") {
      const filters = (campaign.audience_filters || {}) as Record<string, unknown>;
      const groupNames = Array.isArray(filters.group_names) ? (filters.group_names as string[]) : [];

      let q = supabase
        .from("vip_orphan_contacts")
        .select("id, phone, phone_suffix8, display_name, group_names")
        .eq("status", "orphan")
        .eq("opted_out", false)
        .limit(20000);
      const { data: orphans } = await q;
      let list = (orphans || []) as Array<{
        id: string; phone: string; phone_suffix8: string;
        display_name: string | null; group_names: string[];
      }>;

      // Filtro por grupo (opcional)
      if (groupNames.length > 0) {
        list = list.filter((o) => (o.group_names || []).some((g) => groupNames.includes(g)));
      }

      // Remove bloqueados (match cross-instância por DDD + 8 dígitos finais)
      const blockedSet = await loadBlockedSuffixes(supabase);
      list = list.filter((o) => !isBlocked(blockedSet, o.phone));

      if (list.length === 0) return json({ error: "Nenhum destinatário elegível" }, 400);

      // WIRE-IN: enfileira via motor de cotas (guarded). Passa candidatos como
      // {unified_id?, phone, name, contact_id} — a RPC faz auto-upsert de unified,
      // aplica check_touch_quota + matriz tipos_permitidos, grava snapshot de
      // categoria/custo e respeita shadow_mode da campanha.
      const tipo = (campaign.tipo_comunicacao as string) || "oferta";
      const candidates = list.map((o) => ({
        phone: o.phone,
        name: o.display_name,
        contact_id: o.id,
      }));

      const guardedResults: any[] = [];
      const CHUNK = 500;
      let insertedTotal = 0, shadowTotal = 0, excludedTotal = 0, costTotal = 0;
      const reasonsAgg: Record<string, number> = {};
      for (let i = 0; i < candidates.length; i += CHUNK) {
        const slice = candidates.slice(i, i + CHUNK);
        const { data: r, error: rErr } = await supabase.rpc(
          "enqueue_mass_dispatch_targets_guarded",
          {
            p_campaign_id: campaign_id,
            p_candidates: slice,
            p_tipo_comunicacao: tipo,
            p_provider: "uazapi",
            p_template_category: "default",
          } as any,
        );
        if (rErr) {
          console.error("[vip-orphan-dispatch] guarded enqueue error", rErr);
          continue;
        }
        const obj = r as any;
        guardedResults.push(obj);
        insertedTotal += Number(obj?.inserted ?? 0);
        shadowTotal   += Number(obj?.shadow_inserted ?? 0);
        excludedTotal += Number(obj?.excluded ?? 0);
        costTotal     += Number(obj?.cost_estimate_brl ?? 0);
        for (const [k, v] of Object.entries((obj?.reasons ?? {}) as Record<string, number>)) {
          reasonsAgg[k] = (reasonsAgg[k] ?? 0) + Number(v ?? 0);
        }
      }

      const { count } = await supabase
        .from("mass_dispatch_targets")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign_id);

      await supabase
        .from("mass_dispatch_campaigns")
        .update({ status: "running", total_targets: count || 0, started_at: new Date().toISOString() })
        .eq("id", campaign_id);

      return json({
        success: true,
        total_targets: count || 0,
        motor: {
          inserted: insertedTotal,
          shadow_inserted: shadowTotal,
          excluded: excludedTotal,
          reasons: reasonsAgg,
          cost_estimate_brl: costTotal,
        },
      });
    }

    // ── PROCESS ───────────────────────────────────────────────────────
    if (action === "process") {
      if (!campaign.message || !String(campaign.message).trim())
        return json({ error: "Campanha sem mensagem" }, 400);
      if (!campaign.whatsapp_number_id)
        return json({ error: "Campanha sem instância WhatsApp" }, 400);

      const size = Math.min(Math.max(Number(batch_size) || 25, 1), 40);
      const { data: targets } = await supabase
        .from("mass_dispatch_targets")
        .select("id, phone, display_name")
        .eq("campaign_id", campaign_id)
        .eq("status", "pending")
        .limit(size);

      const pending = (targets || []) as Array<{ id: string; phone: string; display_name: string | null }>;
      if (pending.length === 0) {
        await supabase
          .from("mass_dispatch_campaigns")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", campaign_id);
        return json({ success: true, done: true, processed: 0, remaining: 0 });
      }

      const { token } = await resolveUazapiCredentials(campaign.whatsapp_number_id);
      let sent = 0, failed = 0;

      for (const t of pending) {
        const text = String(campaign.message).replace(/\{\{nome\}\}/gi, t.display_name || "").trim();
        try {
          const number = formatUazapiNumber(t.phone);
          const r = await uazapiInstance("/send/text", token, { method: "POST", body: { number, text } });
          if (r.ok) {
            sent++;
            await supabase.from("mass_dispatch_targets").update({
              status: "sent",
              message_id: (r.data?.messageid || r.data?.id || null),
              sent_at: new Date().toISOString(),
            }).eq("id", t.id);
          } else {
            failed++;
            await supabase.from("mass_dispatch_targets").update({
              status: "failed", error: JSON.stringify(r.data).slice(0, 300),
            }).eq("id", t.id);
          }
        } catch (e) {
          failed++;
          await supabase.from("mass_dispatch_targets").update({
            status: "failed", error: (e as Error).message.slice(0, 300),
          }).eq("id", t.id);
        }
        // Delay humano entre envios (anti-ban)
        await sleep(2500 + Math.floor(Math.random() * 2500));
      }

      // Atualiza contadores agregados
      const { count: sentCount } = await supabase
        .from("mass_dispatch_targets").select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign_id).eq("status", "sent");
      const { count: failCount } = await supabase
        .from("mass_dispatch_targets").select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign_id).eq("status", "failed");
      const { count: remaining } = await supabase
        .from("mass_dispatch_targets").select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign_id).eq("status", "pending");

      const done = (remaining || 0) === 0;
      await supabase.from("mass_dispatch_campaigns").update({
        sent_count: sentCount || 0,
        failed_count: failCount || 0,
        status: done ? "completed" : "running",
        completed_at: done ? new Date().toISOString() : null,
      }).eq("id", campaign_id);

      return json({ success: true, done, processed: pending.length, sent, failed, remaining: remaining || 0 });
    }

    return json({ error: "Ação inválida (use prepare|process)" }, 400);
  } catch (e) {
    console.error("[vip-orphan-dispatch] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
