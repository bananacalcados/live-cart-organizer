// Marketing Agent (Estrategista) — Lovable AI Gateway (OpenAI-compat) com tool use,
// memória e confirmação em dois passos.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- TOOLS (formato OpenAI/Gateway) ----------
const TOOLS = [
  { type: "function", function: { name: "get_agent_memory", description: "Carrega decisões ativas, vetos, regras aprendidas, calendário e metas. SEMPRE chame no início da conversa.", parameters: { type: "object", properties: { mes_ref: { type: "string", description: "YYYY-MM (opcional)" } } } } },
  { type: "function", function: { name: "get_classificacao_summary", description: "Distribuição de disparos por classificação (marketing/utility/authentication) nos últimos 30 dias.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_shadow_report", description: "Relatório do ciclo shadow (bloqueios que teriam sido feitos, custo evitado).", parameters: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } } },
  { type: "function", function: { name: "get_live_events_summary", description: "Lives capturadas no mês (viewers, proxy convite_live 5k+, eventos).", parameters: { type: "object", properties: { mes_ref: { type: "string" } }, required: ["mes_ref"] } } },
  { type: "function", function: { name: "get_sales_vs_goals", description: "Vendas por loja vs metas do mês (usa monthly_goals).", parameters: { type: "object", properties: { mes_ref: { type: "string" } }, required: ["mes_ref"] } } },
  { type: "function", function: { name: "get_rfm_summary", description: "Distribuição de clientes por classe RFM.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_stock_by_size", description: "Estoque agregado por numeração/marca/categoria.", parameters: { type: "object", properties: { marca: { type: "string" }, categoria: { type: "string" }, min_estoque: { type: "integer" } } } } },
  { type: "function", function: { name: "get_leads_by_channel", description: "Leads captados por canal no período.", parameters: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } } },
  { type: "function", function: { name: "get_campaign_results", description: "Envios/custo por dia+categoria+provider nos 4 fluxos.", parameters: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } } },
  { type: "function", function: { name: "get_dispatch_pressure", description: "Pressão de toques por classe RFM e exposição a grupos no período.", parameters: { type: "object", properties: { desde: { type: "string" }, ate: { type: "string" } }, required: ["desde", "ate"] } } },
  { type: "function", function: { name: "propor_decisao", description: "PROPÕE gravar uma decisão/veto/regra/pendência. Só grava após confirmação explícita do usuário no próximo turn.", parameters: { type: "object", properties: { tipo: { type: "string", enum: ["decisao", "veto", "regra_aprendida", "pendencia"] }, descricao: { type: "string" }, motivo: { type: "string" }, contexto: { type: "object" } }, required: ["tipo", "descricao"] } } },
  { type: "function", function: { name: "propor_acao_calendario", description: "PROPÕE adicionar ação no calendário. Só grava após confirmação.", parameters: { type: "object", properties: { mes_ref: { type: "string" }, data: { type: "string", description: "YYYY-MM-DD" }, tipo_acao: { type: "string", enum: ["live_grande", "live_loja", "disparo_semanal", "campanha_estoque", "acao_meta_ads", "outro"] }, titulo: { type: "string" }, descricao: { type: "string" }, publico_alvo_descricao: { type: "string" }, custo_estimado_brl: { type: "number" } }, required: ["mes_ref", "data", "tipo_acao", "titulo"] } } },
  { type: "function", function: { name: "propor_meta", description: "PROPÕE definir/atualizar meta mensal por loja. Só grava após confirmação.", parameters: { type: "object", properties: { mes_ref: { type: "string" }, loja: { type: "string", enum: ["perola", "centro", "shopify", "live", "total"] }, meta_faturamento_brl: { type: "number" }, observacao: { type: "string" } }, required: ["mes_ref", "loja", "meta_faturamento_brl"] } } },
];

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

// Chama o Lovable AI Gateway (formato OpenAI Chat Completions).
async function callGateway(apiKey: string, model: string, messages: any[], tools: any[]) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const body: any = { model, messages, tools, tool_choice: "auto" };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify(body),
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

const SYSTEM_PROMPT = `Você é o "Estrategista de Marketing" da Banana Calçados, dentro do módulo Marketing → Calendário.

QUEM VOCÊ FALA: o dono/gestor. Tom direto, analítico, pt-BR. Discorda com DADOS quando necessário. Nunca elogia por elogiar. Confirma antes de gravar qualquer coisa.

O QUE VOCÊ PODE FAZER:
- Ler: use as tools get_* para consultar métricas reais (nunca invente números). SEMPRE chame get_agent_memory PRIMEIRO em cada nova conversa.
- Escrever (com confirmação em DOIS PASSOS):
  1) Você chama propor_decisao / propor_acao_calendario / propor_meta.
  2) O usuário responde "ok"/"confirma"/"grava" mencionando O ITEM.
  3) Só então a proposta vira real (o sistema faz o commit no próximo turn).
- Se o usuário mudar de assunto sem confirmar, a proposta expira. NÃO grave retroativamente.
- Quando houver múltiplas propostas em aberto, pergunte QUAL o "ok" cobre.

RESTRIÇÕES:
- Você NÃO envia mensagens, NÃO dispara campanhas, NÃO altera estoque.
- Sempre cite a fonte (nome da tool) quando apresentar um número.
- Faça agregações por período; não peça dumps enormes.
- Se detectar contradição com um veto ou regra ativa: alerte e proponha alternativa.

FORMATO: markdown curto, listas, negritos em números-chave. Sem emojis excessivos.`;

function isConfirmation(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /\b(ok|confirmo|confirma|pode gravar|grava|sim.{0,10}(pode|grava)|aprovado|confirmado|manda ver)\b/.test(t);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY ausente");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { conversationId: incomingConvId, userMessage } = await req.json();
    if (!userMessage) throw new Error("userMessage obrigatório");

    // Modelo dinâmico (default: gemini-2.5-pro no gateway)
    const { data: modelSetting } = await supabase
      .from("app_settings").select("value").eq("key", "agent_model").maybeSingle();
    let model = (modelSetting?.value as any)?.model || "google/gemini-2.5-pro";
    // Se veio um id Anthropic legado do app_settings, faz fallback silencioso.
    if (model.startsWith("claude")) model = "google/gemini-2.5-pro";

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

    // Monta mensagens no formato OpenAI. Apenas role user/assistant vindas do banco.
    const history = (recentMsgs ?? []).slice().reverse()
      .filter((m: any) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m: any) => ({ role: m.role, content: m.content }));

    if (committedThisTurn.length > 0) {
      history.push({
        role: "user",
        content: `[SISTEMA] O usuário confirmou. Ações gravadas: ${JSON.stringify(committedThisTurn)}. Confirme brevemente ao usuário.`,
      });
    }

    const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }, ...history];

    let steps = 0;
    let finalText = "";
    const executedTools: any[] = [];
    let pendingProposal: any = null;

    while (steps < 8) {
      steps++;
      const resp = await callGateway(LOVABLE_API_KEY, model, messages, TOOLS);
      const msg = resp.choices?.[0]?.message;
      if (!msg) break;
      const toolCalls = msg.tool_calls || [];
      finalText = (msg.content || "").trim();

      if (toolCalls.length === 0) break;

      // Assistant turn com tool_calls
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });

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
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    await supabase.from("agent_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: finalText || "(sem resposta)",
      tool_calls: executedTools.length ? { tools: executedTools } : null,
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
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("marketing-agent-chat error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
