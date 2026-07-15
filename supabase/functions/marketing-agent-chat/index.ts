// Marketing Agent (Estrategista) — Claude tool use com memória e confirmação em dois passos.
// Fase 2 · Etapas 2-3. Leitura de RPCs + escrita em agent_decisions/agent_calendar/monthly_goals.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- TOOLS ----------
const TOOLS = [
  // ----- LEITURA -----
  { name: "get_agent_memory", description: "Carrega decisões ativas, vetos, regras aprendidas, calendário e metas. SEMPRE chame no início da conversa.", input_schema: { type: "object", properties: { mes_ref: { type: "string", description: "YYYY-MM (opcional; sem filtro se omitido)" } } } },
  { name: "get_classificacao_summary", description: "Distribuição de disparos por classificação (marketing/utility/authentication) nos últimos 30 dias.", input_schema: { type: "object", properties: {} } },
  { name: "get_shadow_report", description: "Relatório do ciclo shadow (bloqueios que teriam sido feitos, custo evitado).", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "get_live_events_summary", description: "Lives capturadas no mês (viewers, proxy convite_live 5k+, eventos).", input_schema: { type: "object", properties: { mes_ref: { type: "string" } }, required: ["mes_ref"] } },
  { name: "get_sales_vs_goals", description: "Vendas por loja vs metas do mês (usa monthly_goals).", input_schema: { type: "object", properties: { mes_ref: { type: "string" } }, required: ["mes_ref"] } },
  { name: "get_rfm_summary", description: "Distribuição de clientes por classe RFM.", input_schema: { type: "object", properties: {} } },
  { name: "get_stock_by_size", description: "Estoque agregado por numeração/marca/categoria. Use filtros para drill-down.", input_schema: { type: "object", properties: { marca: { type: "string" }, categoria: { type: "string" }, min_estoque: { type: "integer" } } } },
  { name: "get_leads_by_channel", description: "Leads captados por canal no período.", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "get_campaign_results", description: "Envios/custo por dia+categoria+provider nos 4 fluxos (campanha_envios, live_campaign_dispatches, mass_dispatch, automation).", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  { name: "get_dispatch_pressure", description: "Pressão de toques por classe RFM e exposição a grupos no período.", input_schema: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } },
  // ----- ESCRITA (dois passos: propõe e aguarda 'confirmar' do usuário) -----
  { name: "propor_decisao", description: "PROPÕE gravar uma decisão/veto/regra/pendência. Só grava depois que o usuário confirmar EXPLICITAMENTE.", input_schema: { type: "object", properties: { tipo: { type: "string", enum: ["decisao", "veto", "regra_aprendida", "pendencia"] }, descricao: { type: "string" }, motivo: { type: "string" }, contexto: { type: "object" } }, required: ["tipo", "descricao"] } },
  { name: "propor_acao_calendario", description: "PROPÕE adicionar ação no calendário do estrategista. Só grava após confirmação.", input_schema: { type: "object", properties: { mes_ref: { type: "string" }, data: { type: "string", description: "YYYY-MM-DD" }, tipo_acao: { type: "string", enum: ["live_grande", "live_loja", "disparo_semanal", "campanha_estoque", "acao_meta_ads", "outro"] }, titulo: { type: "string" }, descricao: { type: "string" }, publico_alvo_descricao: { type: "string" }, custo_estimado_brl: { type: "number" } }, required: ["mes_ref", "data", "tipo_acao", "titulo"] } },
  { name: "propor_meta", description: "PROPÕE definir/atualizar meta mensal por loja. Só grava após confirmação.", input_schema: { type: "object", properties: { mes_ref: { type: "string" }, loja: { type: "string", enum: ["perola", "centro", "shopify", "live", "total"] }, meta_faturamento_brl: { type: "number" }, observacao: { type: "string" } }, required: ["mes_ref", "loja", "meta_faturamento_brl"] } },
];

const READ_TOOLS = new Set([
  "get_agent_memory", "get_classificacao_summary", "get_shadow_report",
  "get_live_events_summary", "get_sales_vs_goals", "get_rfm_summary",
  "get_stock_by_size", "get_leads_by_channel", "get_campaign_results",
  "get_dispatch_pressure",
]);

const PROPOSAL_TOOLS = new Set(["propor_decisao", "propor_acao_calendario", "propor_meta"]);

// Executa uma tool de leitura via RPC.
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

// Persiste uma proposta confirmada.
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

async function callClaude(apiKey: string, model: string, system: string, messages: any[], tools: any[]) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4096, system, messages, tools }),
    });
    if (res.ok) return await res.json();
    const errText = await res.text();
    const retryable = res.status === 429 || res.status === 529 || /overloaded|rate.?limit/i.test(errText);
    console.error(`Claude ${res.status}:`, errText.slice(0, 300));
    if (retryable && attempt < 2) { await sleep(800); continue; }
    throw new Error(`Claude ${res.status}: ${errText.slice(0, 200)}`);
  }
  throw new Error("Claude exhausted retries");
}

const SYSTEM_PROMPT = `Você é o "Estrategista de Marketing" da Banana Calçados, dentro do módulo Marketing → Calendário.

QUEM VOCÊ FALA: o dono/gestor. Tom direto, analítico, pt-BR. Discorda com DADOS quando necessário. Nunca elogia por elogiar. Confirma antes de gravar qualquer coisa.

O QUE VOCÊ PODE FAZER:
- Ler: use as tools get_* para consultar métricas reais (nunca invente números). SEMPRE chame get_agent_memory PRIMEIRO em cada nova conversa para carregar decisões/vetos/calendário.
- Escrever (somente com confirmação explícita do usuário, em DOIS PASSOS):
  1) Você chama propor_decisao / propor_acao_calendario / propor_meta.
  2) O usuário responde "ok", "confirma", "grava", "sim, pode gravar" etc. mencionando O ITEM.
  3) Só então a proposta vira real (o sistema faz o commit no próximo turn).
- Se o usuário mudar de assunto sem confirmar, a proposta expira. NÃO grave retroativamente.
- Quando houver múltiplas propostas em aberto, pergunte QUAL o "ok" cobre.

RESTRIÇÕES:
- Você NÃO envia mensagens, NÃO dispara campanhas, NÃO altera estoque. Só planeja e memoriza.
- Sempre cite a fonte (nome da tool) quando apresentar um número.
- Faça agregações por período; não peça dumps enormes.
- Se detectar contradição com um veto ou regra ativa: alerte e proponha alternativa.

FORMATO: markdown curto, listas, negritos em números-chave. Sem emojis excessivos.`;

// Detecção grosseira de confirmação em texto do usuário.
function isConfirmation(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /\b(ok|confirmo|confirma|pode gravar|grava|sim.{0,10}(pode|grava)|aprovado|confirmado|manda ver)\b/.test(t);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY ausente");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { conversationId: incomingConvId, userMessage } = await req.json();
    if (!userMessage) throw new Error("userMessage obrigatório");

    // Resolve modelo dinâmico (app_settings.agent_model)
    const { data: modelSetting } = await supabase
      .from("app_settings").select("value").eq("key", "agent_model").maybeSingle();
    const model = (modelSetting?.value as any)?.model || "claude-sonnet-4-20250514";

    // Autor
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    let createdBy: string | null = null;
    if (jwt) {
      const { data: u } = await supabase.auth.getUser(jwt);
      createdBy = u?.user?.id ?? null;
    }

    // Cria conversa se necessário
    let conversationId = incomingConvId;
    if (!conversationId) {
      const titulo = userMessage.slice(0, 80);
      const { data, error } = await supabase.from("agent_conversations")
        .insert({ titulo, created_by: createdBy }).select().single();
      if (error) throw error;
      conversationId = data.id;
    }

    // Grava mensagem do usuário
    await supabase.from("agent_messages").insert({
      conversation_id: conversationId, role: "user", content: userMessage,
    });

    // Recupera pending_confirmation (última proposta em aberto) e checa confirmação
    const { data: recentMsgs } = await supabase
      .from("agent_messages").select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }).limit(20);

    const committedThisTurn: any[] = [];
    if (isConfirmation(userMessage) && recentMsgs) {
      // Pega a proposta mais recente ainda não commitada
      const lastProposal = recentMsgs.find((m: any) => m.pending_confirmation && !m.pending_confirmation.committed);
      if (lastProposal) {
        const p = lastProposal.pending_confirmation;
        const result = await commitProposal(supabase, p.kind, p.payload, conversationId);
        committedThisTurn.push({ kind: p.kind, payload: p.payload, result });
        // Marca como commitada (idempotência simples)
        await supabase.from("agent_messages").update({
          pending_confirmation: { ...p, committed: true, committed_at: new Date().toISOString() },
        }).eq("id", lastProposal.id);
      }
    }

    // Monta histórico (últimas 20 msgs, cronológica) para o Claude
    const history = (recentMsgs ?? []).slice().reverse().map((m: any) => ({
      role: m.role === "tool" ? "user" : m.role,
      content: m.content ?? "",
    }));
    // Injeta info de commit no contexto se houver
    if (committedThisTurn.length > 0) {
      history.push({
        role: "user",
        content: `[SISTEMA] O usuário confirmou. Ações gravadas: ${JSON.stringify(committedThisTurn)}. Confirme brevemente ao usuário.`,
      });
    }

    // Loop de tool use — até 8 passos.
    let steps = 0;
    let finalText = "";
    const executedTools: any[] = [];
    let pendingProposal: any = null;
    const claudeMessages: any[] = history.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }));

    while (steps < 8) {
      steps++;
      const resp = await callClaude(ANTHROPIC_KEY, model, SYSTEM_PROMPT, claudeMessages, TOOLS);
      const contentBlocks = resp.content || [];
      const toolUseBlocks = contentBlocks.filter((b: any) => b.type === "tool_use");
      const textBlocks = contentBlocks.filter((b: any) => b.type === "text");
      finalText = textBlocks.map((b: any) => b.text).join("\n").trim();

      if (toolUseBlocks.length === 0) break;

      // Assistant turn (com tool_use)
      claudeMessages.push({ role: "assistant", content: contentBlocks });

      const toolResults: any[] = [];
      for (const tb of toolUseBlocks) {
        let result: any;
        if (READ_TOOLS.has(tb.name)) {
          result = await executeReadTool(supabase, tb.name, tb.input);
          executedTools.push({ name: tb.name, input: tb.input });
        } else if (PROPOSAL_TOOLS.has(tb.name)) {
          // NÃO commita. Guarda proposta e devolve marcador para o modelo.
          pendingProposal = { kind: tb.name, payload: tb.input };
          result = {
            proposta_registrada: true,
            aguardando: "confirmação explícita do usuário no próximo turn",
            resumo: tb.input,
          };
        } else {
          result = { error: `Tool desconhecida: ${tb.name}` };
        }
        toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(result) });
      }
      claudeMessages.push({ role: "user", content: toolResults });
    }

    // Grava resposta do assistant + proposta pendente
    await supabase.from("agent_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: finalText || "(sem resposta)",
      tool_calls: executedTools.length ? { tools: executedTools } : null,
      pending_confirmation: pendingProposal ? { ...pendingProposal, created_at: new Date().toISOString() } : null,
    });

    // Atualiza timestamp da conversa
    await supabase.from("agent_conversations")
      .update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);

    return new Response(JSON.stringify({
      conversationId,
      reply: finalText,
      toolCalls: executedTools,
      pendingProposal,
      committed: committedThisTurn,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("marketing-agent-chat error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
