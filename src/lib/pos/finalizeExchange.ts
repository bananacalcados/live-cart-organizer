// Fase 4 — Etapa 2: Finalizar Troca/Devolução
// Orquestra a conferência do retorno, entrada de estoque conforme condição,
// despacho da reposição (reservado -> despachado), ajuste do pedido original
// (total vs parcial) e conclusão do evento.
//
// OBS FISCAL: a emissão da NF-e de devolução (entrada) e da nova NF-e de venda
// acontecem nas Fases 5 e 6 (PlugNotas). Aqui deixamos os ganchos prontos.

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
}

export interface FinalizeExchangeResult {
  totalReturn: boolean;
  restocked: number;
}

export async function finalizeExchange(
  params: FinalizeExchangeParams,
): Promise<FinalizeExchangeResult> {
  const {
    eventId, tipo, loja_origem_id, pedido_original_id, modo_expedicao,
    motivo_cancelamento, sellerName, sellerId, conferidos, reposicaoItemIds,
  } = params;

  let restocked = 0;

  // 1) Atualiza cada item devolvido com o resultado da conferência.
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

    // 2) Entrada de estoque para itens vendáveis confirmados.
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

  // 3) Despacho da reposição (troca com aguarda_retorno): reservado -> despachado.
  if (tipo === "troca" && modo_expedicao === "aguarda_retorno" && reposicaoItemIds.length > 0) {
    await supabase
      .from("trocas_devolucoes_itens")
      .update({ estado_estoque: "despachado" })
      .in("id", reposicaoItemIds)
      .eq("estado_estoque", "reservado");
  }

  // 4) Ajuste do pedido original: total (100%) => cancelado; parcial => mantém.
  const { data: origItems } = await supabase
    .from("pos_sale_items")
    .select("quantity")
    .eq("sale_id", pedido_original_id);
  const totalOriginalQty = (origItems || []).reduce((s: number, r: any) => s + Number(r.quantity || 0), 0);
  const returnedQty = conferidos
    .filter((c) => c.confirmado)
    .reduce((s, c) => s + c.quantidade, 0);
  const totalReturn = totalOriginalQty > 0 && returnedQty >= totalOriginalQty;

  if (totalReturn) {
    await supabase
      .from("pos_sales")
      .update({
        status_cancelamento: "cancelado",
        motivo_cancelamento,
      } as any)
      .eq("id", pedido_original_id);
  }

  // 5) Conclui o evento.
  await supabase
    .from("trocas_devolucoes")
    .update({ status: "concluida" })
    .eq("id", eventId);

  return { totalReturn, restocked };
}
