// Dispara templates do WhatsApp pessoal das vendedoras/gerentes com a lista
// de tarefas pendentes do dia. Roda por cron (a cada 5 min) e respeita os
// horários configurados em pos_task_dispatch_schedules.send_times.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function nowSaoPaulo() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hour}:${parts.minute}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function normalizePhone(raw: string): string {
  let p = (raw || "").replace(/\D/g, "");
  if (!p) return "";
  if (!p.startsWith("55")) p = "55" + p;
  return p;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const fnBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { date, minutes } = nowSaoPaulo();

    const { data: schedules } = await supabase
      .from("pos_task_dispatch_schedules")
      .select("*")
      .eq("is_active", true);

    let sent = 0;
    const WINDOW = 5; // minutos de tolerância (cron a cada 5 min)

    for (const sch of schedules || []) {
      // Algum horário cai na janela atual?
      const times: string[] = sch.send_times || [];
      const due = times.some((t) => {
        const m = parseHHMM(t);
        return m !== null && minutes >= m && minutes < m + WINDOW;
      });
      if (!due) continue;

      // Evita reenvio no mesmo horário/dia
      const lastRun = sch.last_run_at ? new Date(sch.last_run_at) : null;
      if (lastRun && Date.now() - lastRun.getTime() < (WINDOW - 1) * 60000) continue;

      // Vendedoras alvo
      let sellersQ = supabase
        .from("pos_sellers")
        .select("id, name, is_manager, whatsapp_phone")
        .eq("store_id", sch.store_id)
        .eq("is_active", true)
        .not("whatsapp_phone", "is", null);
      if (sch.target === "managers") sellersQ = sellersQ.eq("is_manager", true);
      const { data: sellers } = await sellersQ;

      for (const seller of sellers || []) {
        const phone = normalizePhone(seller.whatsapp_phone);
        if (!phone) continue;

        // Garante que as tarefas do dia existem
        await fetch(`${fnBase}/pos-tasks-generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ storeId: sch.store_id, sellerId: seller.id }),
        }).catch(() => {});

        // Monta a lista de pendências
        const { data: instances } = await supabase
          .from("pos_seller_task_instances")
          .select("status, progress_current, progress_target, definition_id, pos_task_definitions(title)")
          .eq("seller_id", seller.id)
          .eq("due_date", date);

        const pending = (instances || []).filter((i: any) => i.status !== "completed");
        const lines = pending.map((i: any) => {
          const title = i.pos_task_definitions?.title || "Tarefa";
          const prog = i.progress_target > 1 ? ` (${i.progress_current}/${i.progress_target})` : "";
          return `• ${title}${prog}`;
        });
        const tarefasDoDia = lines.length
          ? lines.join(" | ")
          : "Tudo concluído por enquanto! 🎉";

        // Resolve variáveis do template
        const vars = sch.template_variables || {};
        const bodyParameters: string[] = [];
        const ordered = Array.isArray(vars.body) ? vars.body : [];
        for (const v of ordered) {
          if (v === "{{tarefas_do_dia}}" || v === "tarefas_do_dia") bodyParameters.push(tarefasDoDia);
          else if (v === "{{nome}}" || v === "nome") bodyParameters.push(seller.name || "");
          else bodyParameters.push(String(v ?? ""));
        }

        await fetch(`${fnBase}/meta-template-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            phone,
            whatsappNumberId: sch.whatsapp_number_id || undefined,
            templateName: sch.template_name,
            language: sch.template_language || "pt_BR",
            bodyParameters,
          }),
        }).catch((e) => console.error("send error", e));
        sent++;
      }

      await supabase
        .from("pos_task_dispatch_schedules")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", sch.id);
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pos-task-dispatch-cron error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
