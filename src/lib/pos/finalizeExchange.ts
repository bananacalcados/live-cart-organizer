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
  /** True quando a troca ficou aguardando as etapas de NF-e da reposição + rastreio. */
  awaitingShipping?: boolean;
  /** ID da venda-espelho criada em pos_sales para a reposição (só em trocas). */
  posSaleId?: string | null;
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
    origem_canal, cliente_id, valor_devolvido, valor_reposicao,
    resolucao_diferenca, estorno_forma, codigo_devolucao,
  } = params;

  let restocked = 0;

  // Estado atual do evento (guardas de reprocessamento).
  const { data: evtRow } = await supabase
    .from("trocas_devolucoes")
    .select("estoque_movimentado, pedido_ajustado, devolucao_doc_id, resolucao_diferenca")
    .eq("id", eventId)
    .maybeSingle();
  const jaMovimentouEstoque = !!(evtRow as any)?.estoque_movimentado;
  const jaAjustouPedido = !!(evtRow as any)?.pedido_ajustado;
  const jaAtribuiuFaturamento = !!(evtRow as any)?.resolucao_diferenca;

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
          status: "cancelled",
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

  // ── 5) Fase 6: Atribuição de faturamento (duas camadas) — só após fiscalOk ──
  // Layer 1 (documento fiscal) sai sempre pelo valor cheio (já emitido/gancho).
  // Layer 2 (faturamento/comissão interna):
  //   • Venda original permanece com a vendedora original (não estornamos aqui).
  //   • Diferença a mais numa troca → creditada à vendedora que fez a troca.
  //   • Canal site → sem vendedora (equipe de expedição dedicada).
  //   • Diferença a favor do cliente → voucher OU estorno financeiro.
  let atribuicao: FinalizeExchangeResult["atribuicao"] | undefined;
  if (fiscalOk && !jaAtribuiuFaturamento) {
    const valDev = Number(valor_devolvido || 0);
    const valRep = Number(valor_reposicao || 0);
    const diferenca = Number((valRep - valDev).toFixed(2));
    const isSite = origem_canal === "site";

    // Só há faturamento extra da vendedora da troca quando o cliente paga a mais.
    const faturamentoVendedoraTroca = !isSite && diferenca > 0 ? diferenca : 0;

    let resolucao: NonNullable<FinalizeExchangeResult["atribuicao"]>["resolucao"];
    let voucher_codigo: string | null = null;
    let estorno_valor: number | null = null;
    let voucherId: string | null = null;

    if (diferenca > 0.009) {
      resolucao = "cliente_paga";
    } else if (diferenca < -0.009) {
      const favorCliente = Math.abs(diferenca);
      if (resolucao_diferenca === "estorno_financeiro") {
        resolucao = "estorno_financeiro";
        estorno_valor = favorCliente;
        // Movimento financeiro (NÃO faturamento).
        try {
          await supabase.from("cash_flow_entries").insert({
            store_id: loja_origem_id || null,
            entry_date: new Date().toISOString().slice(0, 10),
            direction: "out",
            amount: favorCliente,
            payment_method: estorno_forma || null,
            description: `Estorno troca/devolução ${codigo_devolucao || eventId}`,
            source: "troca_devolucao",
            source_ref_id: eventId,
          } as any);
        } catch (e) {
          console.error("[finalizeExchange] estorno financeiro falhou", e);
        }
      } else {
        // Padrão / explícito: gerar voucher de crédito.
        resolucao = "voucher";
        try {
          const { data: v } = await supabase
            .from("vouchers")
            .insert({
              cliente_id: cliente_id || null,
              valor: favorCliente,
              saldo: favorCliente,
              validade: new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10),
              status: "ativo",
              troca_devolucao_id: eventId,
            } as any)
            .select("id, codigo")
            .single();
          voucherId = (v as any)?.id || null;
          voucher_codigo = (v as any)?.codigo || null;
        } catch (e) {
          console.error("[finalizeExchange] geração de voucher falhou", e);
        }
      }
    } else {
      resolucao = "sem_diferenca";
    }

    await supabase.from("trocas_devolucoes").update({
      valor_devolvido: valDev,
      valor_reposicao: valRep,
      diferenca,
      faturamento_vendedora_troca: faturamentoVendedoraTroca,
      resolucao_diferenca: resolucao,
      estorno_forma: resolucao === "estorno_financeiro" ? (estorno_forma || null) : null,
      voucher_id: voucherId,
    } as any).eq("id", eventId);

    atribuicao = {
      valor_devolvido: valDev,
      valor_reposicao: valRep,
      diferenca,
      faturamento_vendedora_troca: faturamentoVendedoraTroca,
      resolucao,
      voucher_codigo,
      estorno_valor,
    };
  }

  // ── Conclusão: só quando a parte fiscal está resolvida (autorizada/sem nota). ──
  const concluded = fiscalOk;
  let posSaleId: string | null = null;
  let awaitingShipping = false;

  if (concluded) {
    // ── 6) Criar venda-espelho da reposição na aba Pedidos (idempotente) ──
    // Só faz sentido quando é TROCA (tem reposição). Devolução pura não gera venda.
    if (tipo === "troca") {
      try {
        const { data: existing } = await supabase
          .from("pos_sales")
          .select("id")
          .eq("external_source", "troca")
          .eq("external_order_id", eventId)
          .maybeSingle();

        if (existing?.id) {
          posSaleId = (existing as any).id;
        } else {
          const { data: repItems } = await supabase
            .from("trocas_devolucoes_itens")
            .select("sku, barcode, produto_nome, tamanho, quantidade, valor_unitario")
            .eq("troca_devolucao_id", eventId)
            .eq("direcao", "reposicao");

          if (repItems && repItems.length > 0) {
            const subtotal = Number(valor_reposicao || 0);
            const credito = Number(valor_devolvido || 0);
            const diferenca = Number((subtotal - credito).toFixed(2));
            const notaTroca = `🔁 Troca ${codigo_devolucao || eventId} · Crédito devolução: R$ ${credito.toFixed(2)} · Diferença: R$ ${diferenca.toFixed(2)}`;

            const { data: newSale, error: saleErr } = await supabase
              .from("pos_sales")
              .insert({
                store_id: loja_origem_id,
                seller_id: sellerId || null,
                customer_id: cliente_id || null,
                subtotal,
                discount: credito,
                total: Math.max(0, diferenca),
                payment_method: diferenca > 0.009 ? "troca_com_diferenca" : "troca",
                status: "completed",
                sale_type: "exchange",
                external_source: "troca",
                external_order_id: eventId,
                source_order_id: pedido_original_id || null,
                notes: notaTroca,
                paid_at: new Date().toISOString(),
                revenue_attribution: origem_canal === "site" ? "online" : "store",
              } as any)
              .select("id")
              .single();

            if (!saleErr && newSale?.id) {
              posSaleId = (newSale as any).id;
              const itemsPayload = (repItems as any[]).map((r) => ({
                sale_id: newSale.id,
                sku: r.sku || null,
                barcode: r.barcode || null,
                product_name: r.produto_nome || r.sku || "Produto",
                variant_name: r.tamanho || null,
                size: r.tamanho || null,
                unit_price: Number(r.valor_unitario || 0),
                quantity: Number(r.quantidade || 0),
                total_price: Number(r.valor_unitario || 0) * Number(r.quantidade || 0),
              }));
              await supabase.from("pos_sale_items").insert(itemsPayload);
            }
          }
        }
      } catch (e) {
        // best-effort: falha aqui não invalida a troca (fiscal + estoque já OK).
        console.error("[finalizeExchange] criação da venda-espelho da troca falhou", e);
      }
    }

    // ── 7) Se é troca com reposição, aguardar etapas de NF + rastreio antes de concluir ──
    const hasReposicao = tipo === "troca" && !!posSaleId;
    if (hasReposicao) {
      awaitingShipping = true;
      await supabase
        .from("trocas_devolucoes")
        .update({ status: "aguardando_envio", fase2_erro: null } as any)
        .eq("id", eventId);
    } else {
      await supabase
        .from("trocas_devolucoes")
        .update({ status: "concluida", fase2_erro: null })
        .eq("id", eventId);
    }
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

  return { totalReturn, restocked, concluded, awaitingShipping, posSaleId, devolucao, atribuicao };
}
