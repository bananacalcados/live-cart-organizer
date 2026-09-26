// Localiza as notas fiscais de uma troca/devolução:
//  • devolucao → NF-e de devolução (finalidade 4) do produto que voltou
//  • envio     → NF-e do produto novo enviado ao cliente (venda-espelho da reposição)
// Sempre persiste o vínculo (nfe_reposicao_id) quando encontra a nota de envio por fallback.
import { supabase } from "@/integrations/supabase/client";
import { ensureExchangeMirrorSale } from "@/lib/pos/finalizeExchange";

export interface ExchangeNfeDoc {
  id: string;
  status: string;
  chave: string | null;
  danfe_url: string | null;
  xml_content: string | null;
  rejection_message: string | null;
}

const COLS = "id, status, chave_acesso, danfe_url, xml_content, rejection_message, finalidade";

function toDoc(d: any): ExchangeNfeDoc {
  return {
    id: d.id, status: d.status, chave: d.chave_acesso, danfe_url: d.danfe_url,
    xml_content: d.xml_content, rejection_message: d.rejection_message,
  };
}

export async function findMirrorSaleId(eventId: string): Promise<string | null> {
  const { data } = await supabase
    .from("pos_sales").select("id")
    .eq("external_source", "troca").eq("external_order_id", eventId)
    .maybeSingle();
  return (data as any)?.id || null;
}

export async function loadExchangeNfes(ev: { id: string; nfe_reposicao_id?: string | null; devolucao_doc_id?: string | null }) {
  let devolucao: ExchangeNfeDoc | null = null;
  let envio: ExchangeNfeDoc | null = null;

  // Devolução
  const devId = (ev as any).devolucao_doc_id as string | null | undefined;
  if (devId) {
    const { data } = await supabase.from("fiscal_documents").select(COLS).eq("id", devId).maybeSingle();
    if (data) devolucao = toDoc(data);
  }
  if (!devolucao) {
    const { data } = await supabase.from("fiscal_documents").select(COLS)
      .eq("troca_devolucao_id", ev.id).eq("finalidade", 4)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) devolucao = toDoc(data);
  }

  // Envio (reposição)
  if (ev.nfe_reposicao_id) {
    const { data } = await supabase.from("fiscal_documents").select(COLS).eq("id", ev.nfe_reposicao_id).maybeSingle();
    if (data) envio = toDoc(data);
  }
  const mirrorId = await findMirrorSaleId(ev.id);
  if (!envio && mirrorId) {
    const { data } = await supabase.from("fiscal_documents").select(COLS)
      .eq("pos_sale_id", mirrorId).eq("modelo", 55)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data && Number((data as any).finalidade) !== 4) envio = toDoc(data);
  }
  if (!envio) {
    const { data } = await supabase.from("fiscal_documents").select(COLS)
      .eq("troca_devolucao_id", ev.id).neq("finalidade", 4).eq("modelo", 55)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) envio = toDoc(data);
  }
  if (envio && ev.nfe_reposicao_id !== envio.id) {
    await supabase.from("trocas_devolucoes").update({ nfe_reposicao_id: envio.id } as any).eq("id", ev.id);
  }

  return { devolucao, envio, mirrorSaleId: mirrorId };
}

/**
 * Para trocas já concluídas sem nota de envio: cria a venda-espelho (se faltar),
 * emite a NF-e de envio e grava o vínculo na troca.
 */
export async function emitExchangeShippingNfe(ev: any): Promise<ExchangeNfeDoc> {
  let saleId = await findMirrorSaleId(ev.id);
  if (!saleId) {
    const { data: orig } = await supabase.from("pos_sales").select("status").eq("id", ev.pedido_original_id).maybeSingle();
    const r = await ensureExchangeMirrorSale({
      eventId: ev.id,
      loja_origem_id: ev.loja_origem_id,
      pedido_original_id: ev.pedido_original_id,
      origem_canal: ev.origem_canal,
      cliente_id: ev.cliente_id,
      sellerId: ev.vendedora_troca_id || null,
      codigo_devolucao: ev.codigo_devolucao,
      valor_devolvido: ev.valor_devolvido,
      valor_reposicao: ev.valor_reposicao,
      totalReturn: (orig as any)?.status === "cancelled",
    });
    if (!r.posSaleId) throw new Error(r.error || "Não foi possível preparar a venda da reposição");
    saleId = r.posSaleId;
  }
  const { data, error } = await supabase.functions.invoke("nfe-emitir", { body: { sale_id: saleId } });
  if (error) throw new Error(error.message);
  const docId = (data as any)?.document_id || (data as any)?.documentId;
  if (!docId) throw new Error((data as any)?.error || (data as any)?.rejection_message || "Emissão sem documento");
  const { data: doc } = await supabase.from("fiscal_documents").select(COLS).eq("id", docId).maybeSingle();
  if (!doc) throw new Error("Nota emitida, mas não foi possível localizar o documento");
  await supabase.from("trocas_devolucoes").update({ nfe_reposicao_id: docId, fase2_erro: null } as any).eq("id", ev.id);
  return toDoc(doc);
}
