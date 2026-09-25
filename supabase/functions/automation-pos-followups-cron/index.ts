// automation-pos-followups-cron
// Processa os passos agendados das automações disparadas por venda
// (automation_pos_followups) — ex.: "21 dias após a compra, enviar o template
// de cashback". Roda a cada 5 minutos via pg_cron.
//
// Regras importantes:
//  - o prazo é absoluto (scheduled_at), então clicar num botão do template
//    anterior NÃO reinicia a contagem;
//  - as variáveis de cashback são recalculadas AGORA (validade e
//    {{dias_para_expirar}} precisam refletir o dia do envio);
//  - se o passo veio depois de um nó "Comprou?", o guard é reavaliado e o
//    envio é cancelado quando a condição encerra o fluxo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import {
  cashbackVars,
  fetchActiveCashback,
  guardBlocks,
  readGuard,
} from "../_shared/automation-context.ts";
import { isOptedOut } from "../_shared/opt-out.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const BATCH = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(corsHeaders);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let queued = 0;
  let cancelled = 0;
  let skipped = 0;

  try {
    const { data: due } = await supabase
      .from("automation_pos_followups")
      .select("*")
      .is("sent_at", null)
      .is("cancelled_at", null)
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at")
      .limit(BATCH);

    for (const row of (due || []) as any[]) {
      const payload = (row.payload || {}) as any;
      const cfg = (payload.action_config || {}) as any;
      const phone = row.customer_phone as string;

      // Guard "Comprou?" reavaliado no momento do envio
      const guard = readGuard(payload);
      if (await guardBlocks(supabase, phone, guard)) {
        await supabase
          .from("automation_pos_followups")
          .update({ cancelled_at: new Date().toISOString(), cancel_reason: "condition_purchase" })
          .eq("id", row.id);
        cancelled++;
        continue;
      }

      if (await isOptedOut(supabase, phone)) {
        await supabase
          .from("automation_pos_followups")
          .update({ cancelled_at: new Date().toISOString(), cancel_reason: "opted_out" })
          .eq("id", row.id);
        cancelled++;
        continue;
      }

      // Variáveis recalculadas agora (validade / dias para expirar)
      const cb = await fetchActiveCashback(supabase, phone);
      const vars: Record<string, string> = { ...(payload.vars || {}), ...cashbackVars(cb) };
      const replaceVars = (t: string) => {
        if (!t) return t;
        let out = t;
        for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v);
        return out;
      };

      const jobs: Record<string, unknown>[] = [];
      const numberId = cfg.whatsappNumberId || cfg.whatsapp_number_id || null;

      if (payload.action_type === "send_template" && (cfg.templateName || cfg.template_name)) {
        const components: unknown[] = [];
        if (cfg.headerMediaUrl) {
          const isVideo = /\.(mp4|mov|avi|webm)/i.test(String(cfg.headerMediaUrl));
          const headerType = isVideo ? "video" : "image";
          components.push({
            type: "HEADER",
            parameters: [{ type: headerType, [headerType]: { link: cfg.headerMediaUrl } }],
          });
        }
        const tVars = (cfg.templateVars || {}) as Record<string, string>;
        const keys = Object.keys(tVars).sort((a, b) => Number(a) - Number(b));
        if (keys.length > 0) {
          components.push({
            type: "BODY",
            parameters: keys.map((k) => ({ type: "text", text: replaceVars(tVars[k]) || "" })),
          });
        }
        jobs.push({
          kind: "template",
          templateName: cfg.templateName || cfg.template_name,
          language: cfg.language || "pt_BR",
          components,
        });
      } else if (payload.action_type === "send_text") {
        const blocks: any[] = Array.isArray(cfg.blocks) && cfg.blocks.length > 0
          ? cfg.blocks
          : [
            ...(cfg.message ? [{ type: "text", message: cfg.message }] : []),
            ...(cfg.mediaUrl ? [{ type: cfg.mediaType || "document", mediaUrl: cfg.mediaUrl, mediaType: cfg.mediaType }] : []),
          ];
        for (const blk of blocks) {
          if ((blk.type === "document" || blk.mediaType === "document") && blk.previewImageUrl) {
            jobs.push({ kind: "text", mediaUrl: blk.previewImageUrl, mediaType: "image", type: "image" });
          }
          jobs.push({
            kind: "text",
            message: replaceVars(blk.message || ""),
            mediaUrl: blk.mediaUrl,
            mediaType: blk.mediaType,
            type: blk.mediaUrl ? (blk.type || blk.mediaType || "document") : "text",
            fileName: blk.fileName,
          });
        }
      }

      if (jobs.length === 0) {
        await supabase
          .from("automation_pos_followups")
          .update({ sent_at: new Date().toISOString(), cancel_reason: "nothing_to_send" })
          .eq("id", row.id);
        skipped++;
        continue;
      }

      const base = Date.now();
      const rows = jobs.map((job, idx) => ({
        phone,
        flow_id: row.flow_id,
        step_id: row.step_id,
        step_index: row.step_index,
        payload: job,
        whatsapp_number_id: numberId,
        recipient_data: { ...vars, ...(guard ? { __guard__: guard } : {}) },
        scheduled_at: new Date(base + idx * 1500).toISOString(),
      }));

      const { error: qErr } = await supabase
        .from("automation_message_queue")
        .upsert(rows, { onConflict: "phone,flow_id,step_id,scheduled_at", ignoreDuplicates: true });

      if (qErr) {
        console.error("[pos-followups-cron] enqueue error:", qErr);
        continue;
      }

      await supabase
        .from("automation_pos_followups")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", row.id);
      queued += rows.length;
    }

    return new Response(JSON.stringify({ success: true, queued, cancelled, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[pos-followups-cron] fatal:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
