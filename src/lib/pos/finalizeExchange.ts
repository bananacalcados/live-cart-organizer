// Fase 4/5 — Etapa 2: Finalizar Troca/Devolução (com emissão fiscal transacional)
//
// Encadeia as 4 operações da Etapa 2 numa ORDEM SEGURA de commit:
//   1) Conferência dos itens que retornaram (estado/condição) — sempre segura.
//   2) Emissão da NF-e de DEVOLUÇÃO (entrada, finalidade 4) via edge function.
//      → É a "trava fiscal": só depois de AUTORIZADA seguimos para cancelar o pedido.
//   3) Movimentação de estoque (entrada dos vendáveis) + despacho da reposição.
//   4) Ajuste/cancelamento do pedido original — SÓ após a devolução autorizada.
//
// INTEGRIDADE TRANSACIONAL:
//   • Se o SEFAZ rejeitar a devolução, NADA do pedido antigo é cancelado. O evento
//     fica reprocessável (basta chamar finalize de novo — cada passo tem guarda).
//   • Estado intermediário persistido em trocas_devolucoes:
//        devolucao_doc_id, chave_devolucao, estoque_movimentado, pedido_ajustado, fase2_erro
//     permitindo reprocessar APENAS a etapa que faltou, sem refazer o fluxo inteiro.
//
// A nova NF-e de venda (Fase 6) continua sendo um gancho separado.

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type TdEstadoEstoque = Database["public"]["Enums"]["td_estado_estoque"];
type TdTipo = Database["public"]["Enums"]["td_tipo"];

export interface ConferItemInput {
  itemId: string;
  produto_id?: string | null;
  sku?: string | null;
  barcode?: string | null;
  produto_nome?: string | null;
  quantidade: number;
  confirmado: boolean;
  condicao: "vendavel" | "avaria";
}

export interface FinalizeExchangeParams {
  eventId: string;
  tipo: TdTipo;
  loja_origem_id: string;
  pedido_original_id: string;
  modo_expedicao: Database["public"]["Enums"]["td_modo_expedicao"];
  motivo_cancelamento: "troca" | "devolucao";
  sellerName?: string | null;
  sellerId?: string | null;
  conferidos: ConferItemInput[];
  reposicaoItemIds: string[];
  /** Emitir NF-e de devolução (padrão true). */
  emitirDevolucao?: boolean;
  ambiente?: "homologacao" | "producao";

  // ── Fase 6: Atribuição de faturamento (duas camadas) ──
  /** Canal da venda original: 'site' não tem vendedora (equipe de expedição). */
  origem_canal?: Database["public"]["Enums"]["td_origem_canal"];
  /** Cliente para emissão de voucher / estorno. */
  cliente_id?: string | null;
  /** Valor total dos itens devolvidos (confirmados). */
  valor_devolvido: number;
  /** Valor cheio dos produtos de reposição. */
  valor_reposicao: number;
  /**
   * Resolução quando a diferença é a favor do cliente (reposição < devolução):
   * 'voucher' gera crédito; 'estorno_financeiro' devolve o dinheiro.
   * Ignorada quando a diferença é zero ou o cliente é quem paga a mais.
   */
  resolucao_diferenca?: "voucher" | "estorno_financeiro";
  /** Forma do estorno financeiro (quando resolucao_diferenca = 'estorno_financeiro'). */
  estorno_forma?: "pix" | "cartao" | "dinheiro" | null;
  codigo_devolucao?: string | null;
}

export type DevolucaoStatus =
  | "authorized"    // NF-e de devolução autorizada
  | "pending_sefaz" // SEFAZ indisponível — em fila de contingência
  | "rejected"      // rejeitada pela SEFAZ (reprocessável)
  | "skipped"       // venda original sem NF — ramo sem estorno fiscal
  | "error"         // falha inesperada (reprocessável)
  | "disabled";     // emissão desativada nesta chamada

export interface FinalizeExchangeResult {
  totalReturn: boolean;
  restocked: number;
  concluded: boolean;
  devolucao: {
    status: DevolucaoStatus;
    chave?: string | null;
    documentId?: string | null;
    error?: string | null;
  };
  /** Fase 6: atribuição de faturamento (só preenchida quando concluído). */
  atribuicao?: {
    valor_devolvido: number;
    valor_reposicao: number;
    diferenca: number;
    faturamento_vendedora_troca: number;
    resolucao: "cliente_paga" | "voucher" | "estorno_financeiro" | "sem_diferenca";
    voucher_codigo?: string | null;
    estorno_valor?: number | null;
  };
}

/** Chama a edge function de emissão da devolução e normaliza o resultado. */
async function emitirNfeDevolucao(
  eventId: string,
  ambiente?: "homologacao" | "producao",
): Promise<FinalizeExchangeResult["devolucao"]> {
  try {
    const { data, error } = await supabase.functions.invoke("nfe-devolucao-emitir", {
      body: { troca_devolucao_id: eventId, ...(ambiente ? { ambiente } : {}) },
    });

    let payload: any = data;
    if (error) {
      // FunctionsHttpError expõe a Response original em .context — extrai o JSON (422/500)
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === "function") {
        try { payload = await ctx.json(); } catch { /* ignore */ }
      }
      if (!payload) {
        return { status: "error", error: error.message || "Falha ao emitir devolução" };
      }
    }

    if (!payload) return { status: "error", error: "Resposta vazia da emissão" };

    if (payload.skip) return { status: "skipped", error: payload.message || null };
    if (payload.ok) {
      return { status: "authorized", chave: payload.chave_acesso, documentId: payload.document_id };
    }
    if (payload.contingencia) {
      return { status: "pending_sefaz", documentId: payload.document_id, error: payload.message || null };
    }
    return {
      status: "rejected",
      documentId: payload.document_id,
      error: payload.error || payload.message || "Devolução rejeitada pela SEFAZ",
    };
  } catch (e: any) {
    return { status: "error", error: e?.message || "Erro de rede ao emitir devolução" };
  }
}

export async function finalizeExchange(
  params: FinalizeExchangeParams,
): Promise<FinalizeExchangeResult> {
  const {
    eventId, tipo, loja_origem_id, pedido_original_id, modo_expedicao,
    motivo_cancelamento, sellerName, sellerId, conferidos, reposicaoItemIds,
    emitirDevolucao = true, ambiente,
  } = params;

  let restocked = 0;

  // Estado atual do evento (guardas de reprocessamento).
  const { data: evtRow } = await supabase
    .from("trocas_devolucoes")
    .select("estoque_movimentado, pedido_ajustado, devolucao_doc_id")
    .eq("id", eventId)
    .maybeSingle();
  const jaMovimentouEstoque = !!(evtRow as any)?.estoque_movimentado;
  const jaAjustouPedido = !!(evtRow as any)?.pedido_ajustado;

  // ── 1) Conferência: grava estado/condição de cada item devolvido (sempre segura) ──
  for (const it of conferidos) {
    const estado: TdEstadoEstoque | null = it.confirmado
      ? it.condicao === "vendavel"
        ? "retornado_vendavel"
        : "retornado_avaria"
      : null;
    const repoe = it.confirmado && it.condicao === "vendavel";

    await supabase
      .from("trocas_devolucoes_itens")
      .update({
        estado_estoque: estado,
        repoe_estoque: repoe,
        quantidade: it.quantidade,
      })
      .eq("id", it.itemId);
  }

  // ── 2) TRAVA FISCAL: emitir a NF-e de devolução ANTES de mexer no pedido antigo ──
  let devolucao: FinalizeExchangeResult["devolucao"] = { status: "disabled" };
  if (emitirDevolucao) {
    devolucao = await emitirNfeDevolucao(eventId, ambiente);
  }

  const fiscalOk = devolucao.status === "authorized" || devolucao.status === "skipped" || devolucao.status === "disabled";
  const fiscalEmContingencia = devolucao.status === "pending_sefaz";

  // Rejeição/erro definitivo → aborta ANTES de qualquer efeito colateral no pedido/estoque.
  // Evento permanece reprocessável (guardas + devolucao_doc_id apontando o doc rejeitado).
  if (!fiscalOk && !fiscalEmContingencia) {
    await supabase.from("trocas_devolucoes")
      .update({ fase2_erro: devolucao.error || "Falha na emissão da devolução" })
      .eq("id", eventId);
    return { totalReturn: false, restocked: 0, concluded: false, devolucao };
  }

  // ── 3) Estoque: entrada dos vendáveis + despacho da reposição (guardado por flag) ──
  // Roda tanto no caminho autorizado quanto em contingência (produto voltou fisicamente).
  if (!jaMovimentouEstoque) {
    for (const it of conferidos) {
      const repoe = it.confirmado && it.condicao === "vendavel";
      if (repoe && it.quantidade > 0) {
        try {
          await supabase.functions.invoke("pos-stock-balance", {
            body: {
              store_id: loja_origem_id,
              product_id: it.produto_id || undefined,
              sku: it.sku || undefined,
              barcode: it.barcode || undefined,
              quantity: it.quantidade,
              direction: "in",
              reason: `Devolução ${motivo_cancelamento} (retorno vendável)`,
              product_name: it.produto_nome || it.sku || "Produto",
              seller_id: sellerId || undefined,
              seller_name: sellerName || undefined,
            },
          });
          restocked += 1;
        } catch (e) {
          console.error("[finalizeExchange] stock-in falhou", it.sku, e);
        }
      }
    }

    // Despacho da reposição (troca com aguarda_retorno): reservado -> despachado.
    if (tipo === "troca" && modo_expedicao === "aguarda_retorno" && reposicaoItemIds.length > 0) {
      await supabase
        .from("trocas_devolucoes_itens")
        .update({ estado_estoque: "despachado" })
        .in("id", reposicaoItemIds)
        .eq("estado_estoque", "reservado");
    }

    await supabase.from("trocas_devolucoes")
      .update({ estoque_movimentado: true })
      .eq("id", eventId);
  }

  // ── 4) Ajuste do pedido original — SÓ após a devolução AUTORIZADA (ou sem nota) ──
  let totalReturn = false;
  if (fiscalOk && !jaAjustouPedido) {
    const { data: origItems } = await supabase
      .from("pos_sale_items")
      .select("quantity")
      .eq("sale_id", pedido_original_id);
    const totalOriginalQty = (origItems || []).reduce((s: number, r: any) => s + Number(r.quantity || 0), 0);
    const returnedQty = conferidos
      .filter((c) => c.confirmado)
      .reduce((s, c) => s + c.quantidade, 0);
    totalReturn = totalOriginalQty > 0 && returnedQty >= totalOriginalQty;

    // Cancelamento total só quando 100% dos itens voltaram; parcial mantém o pedido.
    if (totalReturn) {
      await supabase
        .from("pos_sales")
        .update({
          status_cancelamento: "cancelado",
          motivo_cancelamento,
        } as any)
        .eq("id", pedido_original_id);
    }

    await supabase.from("trocas_devolucoes")
      .update({ pedido_ajustado: true })
      .eq("id", eventId);
  } else if (jaAjustouPedido) {
    // Reprocessamento: pedido já foi ajustado numa passada anterior.
    totalReturn = false;
  }

  // ── Conclusão: só quando a parte fiscal está resolvida (autorizada/sem nota). ──
  const concluded = fiscalOk;
  if (concluded) {
    await supabase
      .from("trocas_devolucoes")
      .update({ status: "concluida", fase2_erro: null })
      .eq("id", eventId);
  } else {
    // Contingência: fica reprocessável. Marca o motivo para a UI.
    await supabase
      .from("trocas_devolucoes")
      .update({
        status: "recebido_conferencia",
        fase2_erro: devolucao.error || "Devolução em contingência (SEFAZ indisponível)",
      })
      .eq("id", eventId);
  }

  return { totalReturn, restocked, concluded, devolucao };
}
