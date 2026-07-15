// Marketing Agent (Estrategista) — Anthropic (Claude) como motor principal,
// fallback automático para Lovable AI Gateway se ANTHROPIC_API_KEY ausente
// ou se a Anthropic responder erro de crédito/autenticação.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- TOOLS ----------
// Definição canônica em formato Anthropic (input_schema).
// Conversão on-the-fly para formato OpenAI/Gateway quando cair no fallback.
const TOOLS_ANTHROPIC = [
  { name: "get_agent_memory", description: "Carrega decisões ativas, vetos, regras aprendidas, calendário e metas. SEMPRE chame no início da conversa.", input_schema: { type: "object", properties: { mes_ref: { type: "string", description: "YYYY-MM (opcional)" } } } },
  { name: "get_classificacao_summary", description: "Distribuição de disparos por classificação (marketing/utility/authentication) nos últimos 30 dias.", input_schema: { type: "object", properties: {} } },
  { name: "get_shadow_report", description: "Relatório do ciclo shadow (bloqueios que teriam sido feitos, custo evitado).", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "get_live_events_summary", description: "Lives capturadas no mês (viewers, proxy convite_live 5k+, eventos).", input_schema: { type: "object", properties: { mes_ref: { type: "string" } }, required: ["mes_ref"] } },
  { name: "get_sales_vs_goals", description: "Vendas por loja vs metas do mês (usa monthly_goals).", input_schema: { type: "object", properties: { mes_ref: { type: "string" } }, required: ["mes_ref"] } },
  { name: "get_rfm_summary", description: "Distribuição de clientes por classe RFM.", input_schema: { type: "object", properties: {} } },
  { name: "get_stock_by_size", description: "Estoque agregado por numeração/marca/categoria.", input_schema: { type: "object", properties: { marca: { type: "string" }, categoria: { type: "string" }, min_estoque: { type: "integer" } } } },
  { name: "get_leads_by_channel", description: "Leads captados por canal no período.", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "get_campaign_results", description: "Envios/custo por dia+categoria+provider nos 4 fluxos.", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "get_dispatch_pressure", description: "Pressão de toques por classe RFM e exposição a grupos no período.", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "propor_decisao", description: "PROPÕE gravar uma decisão/veto/regra/pendência. Só grava após confirmação explícita do usuário no próximo turn.", input_schema: { type: "object", properties: { tipo: { type: "string", enum: ["decisao", "veto", "regra_aprendida", "pendencia"] }, descricao: { type: "string" }, motivo: { type: "string" }, contexto: { type: "object" } }, required: ["tipo", "descricao"] } },
  { name: "propor_acao_calendario", description: "PROPÕE adicionar ação no calendário. Só grava após confirmação.", input_schema: { type: "object", properties: { mes_ref: { type: "string" }, data: { type: "string", description: "YYYY-MM-DD" }, tipo_acao: { type: "string", enum: ["live_grande", "live_loja", "disparo_semanal", "campanha_estoque", "acao_meta_ads", "outro"] }, titulo: { type: "string" }, descricao: { type: "string" }, publico_alvo_descricao: { type: "string" }, custo_estimado_brl: { type: "number" } }, required: ["mes_ref", "data", "tipo_acao", "titulo"] } },
  { name: "propor_meta", description: "PROPÕE definir/atualizar meta mensal por loja. Só grava após confirmação.", input_schema: { type: "object", properties: { mes_ref: { type: "string" }, loja: { type: "string", enum: ["perola", "centro", "shopify", "live", "total"] }, meta_faturamento_brl: { type: "number" }, observacao: { type: "string" } }, required: ["mes_ref", "loja", "meta_faturamento_brl"] } },
];

const TOOLS_OPENAI = TOOLS_ANTHROPIC.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

const READ_TOOLS = new Set([
  "get_agent_memory", "get_classificacao_summary", "get_shadow_report",
  "get_live_events_summary", "get_sales_vs_goals", "get_rfm_summary",
  "get_stock_by_size", "get_leads_by_channel", "get_campaign_results",
  "get_dispatch_pressure",
]);
const PROPOSAL_TOOLS = new Set(["propor_decisao", "propor_acao_calendario", "propor_meta"]);

async function executeReadTool(supabase: any, name: string, input: any): Promise<any> {
  const rpcMap: Record<string, { fn: string; args: (i: any) => any }> = {
    get_agent_memory: { fn: "get_agent_memory", args: (i) => ({ p_mes_ref: i.mes_ref ?? null }) },
    get_classificacao_summary: { fn: "get_classificacao_summary", args: () => ({}) },
    get_shadow_report: { fn: "get_shadow_report", args: (i) => ({ p_desde: i.desde, p_ate: i.ate }) },
    get_live_events_summary: { fn: "get_live_events_summary", args: (i) => ({ p_mes_ref: i.mes_ref }) },
    get_sales_vs_goals: { fn: "get_sales_vs_goals", args: (i) => ({ p_mes_ref: i.mes_ref }) },
    get_rfm_summary: { fn: "get_rfm_summary", args: () => ({}) },
    get_stock_by_size: { fn: "get_stock_by_size", args: (i) => ({ p_filtros: { marca: i.marca, categoria: i.categoria, min_estoque: i.min_estoque } }) },
    get_leads_by_channel: { fn: "get_leads_by_channel", args: (i) => ({ p_desde: i.desde, p_ate: i.ate }) },
    get_campaign_results: { fn: "get_campaign_results", args: (i) => ({ p_desde: i.desde, p_ate: i.ate }) },
    get_dispatch_pressure: { fn: "get_dispatch_pressure", args: (i) => ({ p_desde: i.desde, p_ate: i.ate }) },
  };
  const m = rpcMap[name];
  if (!m) return { error: `RPC ${name} não mapeada` };
  const { data, error } = await supabase.rpc(m.fn, m.args(input));
  if (error) return { error: error.message };
  return data;
}

async function commitProposal(supabase: any, kind: string, payload: any, conversationId: string) {
  if (kind === "propor_decisao") {
    const { data, error } = await supabase.from("agent_decisions").insert({
      conversation_id: conversationId,
      tipo: payload.tipo,
      descricao: payload.descricao,
      motivo: payload.motivo ?? null,
      contexto: payload.contexto ?? {},
    }).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id };
  }
  if (kind === "propor_acao_calendario") {
    const { data, error } = await supabase.from("agent_calendar").insert({
      conversation_id: conversationId,
      mes_ref: payload.mes_ref,
      data: payload.data,
      tipo_acao: payload.tipo_acao,
      titulo: payload.titulo,
      descricao: payload.descricao ?? null,
      publico_alvo_descricao: payload.publico_alvo_descricao ?? null,
      custo_estimado_brl: payload.custo_estimado_brl ?? null,
    }).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id };
  }
  if (kind === "propor_meta") {
    const { data, error } = await supabase.from("monthly_goals").upsert({
      mes_ref: payload.mes_ref,
      loja: payload.loja,
      meta_faturamento_brl: payload.meta_faturamento_brl,
      observacao: payload.observacao ?? null,
    }, { onConflict: "mes_ref,loja" }).select().single();
    return error ? { error: error.message } : { ok: true, id: data.id };
  }
  return { error: `kind desconhecido: ${kind}` };
}

function buildSystemPrompt(): string {
  const now = new Date();
  const brNow = new Date(now.getTime() - 3 * 60 * 60 * 1000); // America/Sao_Paulo (UTC-3)
  const isoDate = brNow.toISOString().slice(0, 10);
  const mesRef = isoDate.slice(0, 7);
  const humano = brNow.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return `Você é o "Estrategista de Marketing" da Banana Calçados, dentro do módulo Marketing → Calendário.

CONTEXTO TEMPORAL (fonte da verdade — NUNCA infira data de outra forma):
- Hoje é ${humano} (${isoDate}, America/Sao_Paulo).
- Mês de referência padrão para consultas mensais: ${mesRef}.
- Ao chamar tools com "mes_ref", use ${mesRef} salvo se o usuário pedir outro mês explicitamente.

QUEM VOCÊ FALA: o dono/gestor. Tom direto, analítico, pt-BR. Discorda com DADOS quando necessário. Nunca elogia por elogiar. Confirma antes de gravar qualquer coisa.

O QUE VOCÊ PODE FAZER:
- Ler: use as tools get_* para consultar métricas reais (nunca invente números). SEMPRE chame get_agent_memory PRIMEIRO em cada nova conversa.
- Escrever (com confirmação em DOIS PASSOS):
  1) Você chama propor_decisao / propor_acao_calendario / propor_meta.
  2) O usuário responde "ok"/"confirma"/"grava" mencionando O ITEM.
  3) Só então a proposta vira real (o sistema faz o commit no próximo turn).
- Se o usuário mudar de assunto sem confirmar, a proposta expira. NÃO grave retroativamente.
- Quando houver múltiplas propostas em aberto, pergunte QUAL o "ok" cobre.

FONTES DE METAS:
- get_sales_vs_goals já une metas de faturamento por loja cadastradas no PDV (Dashboard Geral → pos_goals) com metas manuais em monthly_goals.
- Se uma loja aparecer com meta = 0, é porque não há meta cadastrada para o mês naquela loja — avise e proponha antes de assumir números.

RESTRIÇÕES:
- Você NÃO envia mensagens, NÃO dispara campanhas, NÃO altera estoque.
- Sempre cite a fonte (nome da tool) quando apresentar um número.
- Faça agregações por período; não peça dumps enormes.
- Se detectar contradição com um veto ou regra ativa: alerte e proponha alternativa.

FORMATO: markdown curto, listas, negritos em números-chave. Sem emojis excessivos.`;
}
const SYSTEM_PROMPT_FALLBACK = "Estrategista de Marketing da Banana Calçados.";

function isConfirmation(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /\b(ok|confirmo|confirma|pode gravar|grava|sim.{0,10}(pode|grava)|aprovado|confirmado|manda ver)\b/.test(t);
}

// ---------- ANTHROPIC ----------
async function callAnthropic(apiKey: string, model: string, system: string, messages: any[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      tools: TOOLS_ANTHROPIC,
      messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    const err: any = new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`);
    err.status = res.status;
    err.body = errText;
    throw err;
  }
  return await res.json();
}

// Erros da Anthropic que devem cair no fallback (não retentar).
function shouldFallbackFromAnthropic(err: any): boolean {
  if (!err) return false;
  const status = err.status;
  const body = String(err.body || err.message || "");
  if (status === 401 || status === 403) return true; // auth
  if (status === 402) return true;
  if (/credit balance|billing|insufficient|quota/i.test(body)) return true;
  return false;
}

// ---------- LOVABLE AI GATEWAY (OpenAI-compat) ----------
async function callGateway(apiKey: string, model: string, messages: any[]) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({ model, messages, tools: TOOLS_OPENAI, tool_choice: "auto" }),
    });
    if (res.ok) return await res.json();
    const errText = await res.text();
    console.error(`Gateway ${res.status}:`, errText.slice(0, 400));
    if (res.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
    if (res.status >= 500 && attempt < 3) { await sleep(600 * attempt); continue; }
    throw new Error(`Gateway ${res.status}: ${errText.slice(0, 200)}`);
  }
  throw new Error("Gateway exhausted retries");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!ANTHROPIC_API_KEY && !LOVABLE_API_KEY) {
      throw new Error("Nenhum provedor de IA configurado (ANTHROPIC_API_KEY ou LOVABLE_API_KEY).");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { conversationId: incomingConvId, userMessage } = await req.json();
    if (!userMessage) throw new Error("userMessage obrigatório");

    // Modelo dinâmico: guarda tanto o modelo Anthropic quanto o fallback do gateway.
    const { data: modelSetting } = await supabase
      .from("app_settings").select("value").eq("key", "agent_model").maybeSingle();
    const cfg: any = modelSetting?.value || {};
    const anthropicModel = cfg.anthropic_model || (typeof cfg.model === "string" && cfg.model.startsWith("claude") ? cfg.model : "claude-sonnet-4-5");
    const gatewayModel = cfg.gateway_model || (typeof cfg.model === "string" && !cfg.model.startsWith("claude") ? cfg.model : "google/gemini-2.5-pro");

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    let createdBy: string | null = null;
    if (jwt) {
      const { data: u } = await supabase.auth.getUser(jwt);
      createdBy = u?.user?.id ?? null;
    }

    let conversationId = incomingConvId;
    if (!conversationId) {
      const titulo = userMessage.slice(0, 80);
      const { data, error } = await supabase.from("agent_conversations")
        .insert({ titulo, created_by: createdBy }).select().single();
      if (error) throw error;
      conversationId = data.id;
    }

    await supabase.from("agent_messages").insert({
      conversation_id: conversationId, role: "user", content: userMessage,
    });

    const { data: recentMsgs } = await supabase
      .from("agent_messages").select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }).limit(20);

    const committedThisTurn: any[] = [];
    if (isConfirmation(userMessage) && recentMsgs) {
      const lastProposal = recentMsgs.find((m: any) => m.pending_confirmation && !m.pending_confirmation.committed);
      if (lastProposal) {
        const p = lastProposal.pending_confirmation;
        const result = await commitProposal(supabase, p.kind, p.payload, conversationId);
        committedThisTurn.push({ kind: p.kind, payload: p.payload, result });
        await supabase.from("agent_messages").update({
          pending_confirmation: { ...p, committed: true, committed_at: new Date().toISOString() },
        }).eq("id", lastProposal.id);
      }
    }

    const history = (recentMsgs ?? []).slice().reverse()
      .filter((m: any) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m: any) => ({ role: m.role, content: m.content }));

    if (committedThisTurn.length > 0) {
      history.push({
        role: "user",
        content: `[SISTEMA] O usuário confirmou. Ações gravadas: ${JSON.stringify(committedThisTurn)}. Confirme brevemente ao usuário.`,
      });
    }

    // Decide provedor
    const useAnthropic = !!ANTHROPIC_API_KEY;
    let provider: "anthropic" | "gateway" = useAnthropic ? "anthropic" : "gateway";

    const executedTools: any[] = [];
    let pendingProposal: any = null;
    let finalText = "";

    async function runAnthropic(): Promise<void> {
      const msgs: any[] = history.map((m: any) => ({ role: m.role, content: m.content }));
      let steps = 0;
      while (steps < 8) {
        steps++;
        const resp = await callAnthropic(ANTHROPIC_API_KEY!, anthropicModel, buildSystemPrompt(), msgs);
        const blocks: any[] = resp.content || [];
        const textBlocks = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        const toolUses = blocks.filter((b) => b.type === "tool_use");
        if (textBlocks) finalText = textBlocks;
        if (toolUses.length === 0) return;

        msgs.push({ role: "assistant", content: blocks });
        const toolResults: any[] = [];
        for (const tu of toolUses) {
          let result: any;
          if (READ_TOOLS.has(tu.name)) {
            result = await executeReadTool(supabase, tu.name, tu.input || {});
            executedTools.push({ name: tu.name, input: tu.input });
          } else if (PROPOSAL_TOOLS.has(tu.name)) {
            pendingProposal = { kind: tu.name, payload: tu.input };
            result = { proposta_registrada: true, aguardando: "confirmação explícita do usuário no próximo turn", resumo: tu.input };
          } else {
            result = { error: `Tool desconhecida: ${tu.name}` };
          }
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
        }
        msgs.push({ role: "user", content: toolResults });
      }
    }

    async function runGateway(): Promise<void> {
      const msgs: any[] = [{ role: "system", content: buildSystemPrompt() }, ...history];
      let steps = 0;
      while (steps < 8) {
        steps++;
        const resp = await callGateway(LOVABLE_API_KEY!, gatewayModel, msgs);
        const msg = resp.choices?.[0]?.message;
        if (!msg) return;
        const toolCalls = msg.tool_calls || [];
        finalText = (msg.content || "").trim() || finalText;
        if (toolCalls.length === 0) return;
        msgs.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
        for (const tc of toolCalls) {
          const name = tc.function?.name;
          let input: any = {};
          try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { /* ignore */ }
          let result: any;
          if (READ_TOOLS.has(name)) {
            result = await executeReadTool(supabase, name, input);
            executedTools.push({ name, input });
          } else if (PROPOSAL_TOOLS.has(name)) {
            pendingProposal = { kind: name, payload: input };
            result = { proposta_registrada: true, aguardando: "confirmação explícita do usuário no próximo turn", resumo: input };
          } else {
            result = { error: `Tool desconhecida: ${name}` };
          }
          msgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
        }
      }
    }

    if (useAnthropic) {
      try {
        await runAnthropic();
      } catch (e: any) {
        if (shouldFallbackFromAnthropic(e) && LOVABLE_API_KEY) {
          console.warn("Anthropic indisponível, caindo para Lovable AI Gateway:", e.message);
          provider = "gateway";
          // reseta estado parcial
          executedTools.length = 0;
          pendingProposal = null;
          finalText = "";
          await runGateway();
        } else {
          throw e;
        }
      }
    } else {
      await runGateway();
    }

    await supabase.from("agent_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: finalText || "(sem resposta)",
      tool_calls: executedTools.length ? { tools: executedTools, provider } : { provider },
      pending_confirmation: pendingProposal ? { ...pendingProposal, created_at: new Date().toISOString() } : null,
    });

    await supabase.from("agent_conversations")
      .update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);

    return new Response(JSON.stringify({
      conversationId,
      reply: finalText,
      toolCalls: executedTools,
      pendingProposal,
      committed: committedThisTurn,
      provider,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("marketing-agent-chat error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
