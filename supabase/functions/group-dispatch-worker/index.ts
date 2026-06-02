// WORKER reentrante de disparo VIP (Fila Durável com Delay Agendado)
// ------------------------------------------------------------------
// Consome a tabela group_campaign_block_dispatches:
//  - Para cada INSTÂNCIA com job pronto (send_after <= agora), reivindica o
//    PRÓXIMO job (menor seq) com claim_group_dispatch_job (serializado por
//    instância → anti-ban) e envia 1 mensagem.
//  - Instâncias diferentes rodam em PARALELO (cada uma no seu ritmo).
//  - Após enviar, agenda o próximo job: send_after = agora + delay_after_ms
//    (delay VARIÁVEL/humanizado já sorteado pelo planner).
//  - Estado vive no banco → imune a timeout. O cron reinvoca para drenar.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPausedGroupSendUntil } from "../_shared/group-send-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_RUN_MS = 50_000;   // orçamento por invocação (cron reinvoca)
const IDLE_POLL_MS = 2_500;  // espera curta quando há jobs mas nenhum pronto
const RETRY_DELAY_MS = 8_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const start = Date.now();

  // Caches por execução (evita reconsultar a cada job)
  const varsCache = new Map<string, Record<string, string>>();
  const providerCache = new Map<string, string>();
  const blockCache = new Map<string, any>();

  // ===== Helpers =====
  const dispatchFilter = (q: any, job: any) =>
    job.message_group_id
      ? q.eq("message_group_id", job.message_group_id)
      : q.eq("scheduled_message_id", job.scheduled_message_id);

  async function getCampaignVars(campaignId: string): Promise<Record<string, string>> {
    if (varsCache.has(campaignId)) return varsCache.get(campaignId)!;
    const { data } = await supabase
      .from("campaign_variables")
      .select("variable_name, variable_value")
      .eq("campaign_id", campaignId);
    const vars: Record<string, string> = {};
    if (data) for (const v of data) vars[v.variable_name] = v.variable_value;
    const now = new Date();
    vars["data_hoje"] = now.toLocaleDateString("pt-BR");
    vars["horario"] = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    varsCache.set(campaignId, vars);
    return vars;
  }

  async function getProvider(numberId: string | null): Promise<string> {
    if (!numberId) return "zapi";
    if (providerCache.has(numberId)) return providerCache.get(numberId)!;
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("provider")
      .eq("id", numberId)
      .maybeSingle();
    const provider = data?.provider || "zapi";
    providerCache.set(numberId, provider);
    return provider;
  }

  // Recupera o conteúdo do bloco a partir das mensagens agendadas
  async function getBlock(job: any): Promise<any | null> {
    const key = `${job.message_group_id || job.scheduled_message_id}:${job.block_order}`;
    if (blockCache.has(key)) return blockCache.get(key);
    let block: any = null;
    if (job.message_group_id) {
      const { data } = await supabase
        .from("group_campaign_scheduled_messages")
        .select("*")
        .eq("message_group_id", job.message_group_id)
        .eq("block_order", job.block_order)
        .maybeSingle();
      block = data;
    } else {
      const { data } = await supabase
        .from("group_campaign_scheduled_messages")
        .select("*")
        .eq("id", job.scheduled_message_id)
        .maybeSingle();
      block = data;
    }
    if (block) blockCache.set(key, block);
    return block;
  }

  const replaceVars = (text: string, vars: Record<string, string>, groupName: string): string => {
    let result = text || "";
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
    }
    return result.replace(/\{\{nome_grupo\}\}/g, groupName);
  };

  async function callFn(fnName: string, body: Record<string, unknown>) {
    const r = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    const ok = r.ok && data?.success !== false && !data?.error;
    return { ok, error: ok ? null : (data?.error || data?.data?.error || `http_${r.status}`) };
  }

  // ===== Roteamento de envio por provider =====
  async function sendBlock(provider: string, block: any, job: any, content: string) {
    const groupId = job.group_zapi_id;
    const numberId = job.whatsapp_number_id;
    const isPoll = block.message_type === "poll" && Array.isArray(block.poll_options) && block.poll_options.length >= 2;
    const isMedia = block.message_type !== "text" && block.media_url;
    const pollSel = block.poll_max_options && block.poll_max_options > 0 ? block.poll_max_options : 1;

    if (provider === "wasender") {
      if (isPoll) {
        return callFn("wasender-send-extra", {
          kind: "poll", phone: groupId, whatsapp_number_id: numberId,
          poll: { name: content || "Enquete", options: block.poll_options, selectableCount: pollSel },
        });
      }
      if (isMedia) {
        return callFn("wasender-send-media", {
          phone: groupId, mediaUrl: block.media_url, mediaType: block.message_type, caption: content, whatsapp_number_id: numberId,
        });
      }
      if (block.mention_all) {
        return callFn("wasender-groups", { action: "sendMessage", groupJid: groupId, message: content, whatsapp_number_id: numberId });
      }
      return callFn("wasender-send-message", { phone: groupId, message: content, whatsapp_number_id: numberId });
    }

    if (provider === "uazapi") {
      if (isPoll) {
        return callFn("uazapi-send-extra", {
          kind: "poll", phone: groupId, whatsapp_number_id: numberId,
          poll: { question: content || "Enquete", options: block.poll_options, selectableCount: pollSel },
        });
      }
      if (isMedia) {
        return callFn("uazapi-send-media", {
          phone: groupId, mediaUrl: block.media_url, mediaType: block.message_type, caption: content, whatsapp_number_id: numberId,
        });
      }
      if (block.mention_all) {
        return callFn("uazapi-groups", { action: "sendMessage", groupJid: groupId, message: content, whatsapp_number_id: numberId });
      }
      return callFn("uazapi-send-message", { phone: groupId, message: content, whatsapp_number_id: numberId });
    }

    // ===== Z-API (default) =====
    const body: Record<string, unknown> = {
      groupId, mentionAll: block.mention_all || false, whatsapp_number_id: numberId,
    };
    if (isPoll) {
      body.type = "poll";
      body.pollOptions = block.poll_options;
      body.message = content;
      body.pollMaxOptions = block.poll_max_options ?? 1;
    } else if (isMedia) {
      body.type = block.message_type;
      body.mediaUrl = block.media_url;
      body.caption = content;
      body.message = content;
    } else {
      body.type = "text";
      body.message = content;
    }
    return callFn("zapi-send-group-message", body);
  }

  // Agenda o próximo job da MESMA campanha (libera após o delay deste job)
  async function scheduleNext(job: any) {
    const { data: next } = await dispatchFilter(
      supabase
        .from("group_campaign_block_dispatches")
        .select("id")
        .eq("status", "pending")
        .not("seq", "is", null)
        .is("send_after", null)
        .gt("seq", job.seq)
        .order("seq", { ascending: true })
        .limit(1),
      job,
    );
    if (next && next.length > 0) {
      const delay = Math.max(0, job.delay_after_ms || 0);
      await supabase
        .from("group_campaign_block_dispatches")
        .update({ send_after: new Date(Date.now() + delay).toISOString() })
        .eq("id", next[0].id);
    }
  }

  // Conclusão de grupo / disparo → atualiza as mensagens agendadas
  async function reconcile(job: any) {
    // Jobs restantes pendentes do grupo
    const { count: groupPending } = await dispatchFilter(
      supabase
        .from("group_campaign_block_dispatches")
        .select("id", { count: "exact", head: true })
        .eq("group_db_id", job.group_db_id)
        .not("seq", "is", null)
        .eq("status", "pending"),
      job,
    );

    if (groupPending === 0) {
      // Grupo concluído: marca sent_group_ids + contadores
      const { data: gJobs } = await dispatchFilter(
        supabase
          .from("group_campaign_block_dispatches")
          .select("status")
          .eq("group_db_id", job.group_db_id)
          .not("seq", "is", null),
        job,
      );
      const anyFailed = (gJobs || []).some((j: any) => j.status === "failed");
      const allFailed = (gJobs || []).length > 0 && (gJobs || []).every((j: any) => j.status === "failed");

      const { data: cur } = await supabase
        .from("group_campaign_scheduled_messages")
        .select("sent_group_ids, sent_count, failed_count")
        .eq("id", job.scheduled_message_id)
        .maybeSingle();

      const sentIds: string[] = cur?.sent_group_ids || [];
      if (!sentIds.includes(job.group_db_id)) {
        sentIds.push(job.group_db_id);
        const col = job.message_group_id ? "message_group_id" : "id";
        const val = job.message_group_id || job.scheduled_message_id;
        await supabase
          .from("group_campaign_scheduled_messages")
          .update({
            sent_group_ids: sentIds,
            sent_count: (cur?.sent_count || 0) + (allFailed ? 0 : 1),
            failed_count: (cur?.failed_count || 0) + (anyFailed ? 1 : 0),
            locked_until: new Date(Date.now() + 120_000).toISOString(),
          })
          .eq(col, val);
      }
    }

    // Jobs restantes do disparo inteiro
    const { count: dispatchPending } = await dispatchFilter(
      supabase
        .from("group_campaign_block_dispatches")
        .select("id", { count: "exact", head: true })
        .not("seq", "is", null)
        .eq("status", "pending"),
      job,
    );

    if (dispatchPending === 0) {
      const col = job.message_group_id ? "message_group_id" : "id";
      const val = job.message_group_id || job.scheduled_message_id;
      await supabase
        .from("group_campaign_scheduled_messages")
        .update({ status: "sent", sent_at: new Date().toISOString(), locked_until: null })
        .eq(col, val)
        .in("status", ["sending", "pending", "grouped"]);
    }
  }

  // Cancela toda a fila pendente do disparo (pausa global)
  async function cancelDispatch(job: any) {
    await dispatchFilter(
      supabase
        .from("group_campaign_block_dispatches")
        .update({ status: "cancelled", locked_until: null })
        .not("seq", "is", null)
        .eq("status", "pending"),
      job,
    );
    const col = job.message_group_id ? "message_group_id" : "id";
    const val = job.message_group_id || job.scheduled_message_id;
    await supabase
      .from("group_campaign_scheduled_messages")
      .update({ status: "cancelled", locked_until: null })
      .eq(col, val)
      .in("status", ["sending", "pending", "grouped"]);
  }

  // Processa 1 job de uma instância
  async function processInstance(numberId: string): Promise<boolean> {
    const { data: claimed } = await supabase.rpc("claim_group_dispatch_job", { p_number_id: numberId });
    const job = claimed && claimed.length > 0 ? claimed[0] : null;
    if (!job) return false;

    // Pausa global → cancela disparo
    const paused = await getPausedGroupSendUntil(supabase);
    if (paused) {
      await cancelDispatch(job);
      return true;
    }

    const block = await getBlock(job);
    if (!block) {
      await supabase.from("group_campaign_block_dispatches")
        .update({ status: "failed", error_message: "block_not_found", locked_until: null })
        .eq("id", job.id);
      await scheduleNext(job);
      await reconcile(job);
      return true;
    }

    const vars = job.campaign_id ? await getCampaignVars(job.campaign_id) : {};
    const provider = await getProvider(job.whatsapp_number_id);
    const content = replaceVars(block.message_content || "", vars, job.group_name || "");

    // Envio com 1 retry
    let res = await sendBlock(provider, block, job, content);
    let attempts = 1;
    if (!res.ok) {
      await sleep(RETRY_DELAY_MS);
      res = await sendBlock(provider, block, job, content);
      attempts = 2;
    }

    if (res.ok) {
      await supabase.from("group_campaign_block_dispatches")
        .update({ status: "sent", attempts, sent_at: new Date().toISOString(), locked_until: null })
        .eq("id", job.id);
    } else {
      await supabase.from("group_campaign_block_dispatches")
        .update({ status: "failed", attempts, error_message: String(res.error || "send_failed").slice(0, 500), locked_until: null })
        .eq("id", job.id);
    }

    // Avança a fila (mesmo em falha, para não travar o disparo)
    await scheduleNext(job);
    await reconcile(job);
    return true;
  }

  // ===== Loop principal =====
  let processed = 0;
  try {
    while (Date.now() - start < MAX_RUN_MS) {
      const { data: ready } = await supabase.rpc("get_group_dispatch_ready_instances");
      const instances: string[] = (ready || []).map((r: any) => r.whatsapp_number_id).filter(Boolean);

      if (instances.length === 0) {
        // Há jobs pendentes (mas ainda não liberados)?
        const { count: pendingCount } = await supabase
          .from("group_campaign_block_dispatches")
          .select("id", { count: "exact", head: true })
          .not("seq", "is", null)
          .eq("status", "pending");
        if (!pendingCount || pendingCount === 0) break; // fila vazia → encerra
        await sleep(IDLE_POLL_MS); // aguarda o gap dos delays
        continue;
      }

      // Instâncias diferentes em paralelo (1 job por instância por ciclo)
      const results = await Promise.all(instances.map((id) => processInstance(id).catch(() => false)));
      processed += results.filter(Boolean).length;
    }
  } catch (e) {
    console.error("Worker loop error:", e);
  }

  return new Response(
    JSON.stringify({ success: true, processed, elapsedMs: Date.now() - start }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
