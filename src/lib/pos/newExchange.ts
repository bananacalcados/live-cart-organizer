// Fase 3 — Etapa 1: Nova Troca/Devolução
// Cria o registro em trocas_devolucoes + itens e gera o PDF da etiqueta/instrução de devolução.
// IMPORTANTE: nesta etapa NÃO se emite nota fiscal de devolução. A reserva de estoque
// da reposição é apenas lógica (estado 'reservado'/'despachado' no item) — NÃO altera a
// contagem física em pos_products.

import { supabase } from "@/integrations/supabase/client";
import jsPDF from "jspdf";
import type { Database } from "@/integrations/supabase/types";

type TdTipo = Database["public"]["Enums"]["td_tipo"];
type TdMotivo = Database["public"]["Enums"]["td_motivo"];
type TdOrigemCanal = Database["public"]["Enums"]["td_origem_canal"];
type TdModoExpedicao = Database["public"]["Enums"]["td_modo_expedicao"];
type TdStatus = Database["public"]["Enums"]["td_status"];
type TdEstadoEstoque = Database["public"]["Enums"]["td_estado_estoque"];

export interface ExchangeItemInput {
  produto_id?: string | null;
  sku?: string | null;
  barcode?: string | null;
  produto_nome?: string | null;
  tamanho?: string | null;
  quantidade: number;
  valor_unitario: number;
  repoe_estoque: boolean;
}

export interface ReposicaoItemInput {
  produto_id?: string | null;
  sku?: string | null;
  barcode?: string | null;
  produto_nome?: string | null;
  tamanho?: string | null;
  quantidade: number;
  valor_unitario: number;
  estado_estoque: TdEstadoEstoque; // 'reservado' | 'despachado'
}

export interface CreateExchangeParams {
  tipo: TdTipo;
  motivo: TdMotivo;
  origem_canal: TdOrigemCanal;
  loja_origem_id: string;
  loja_nome?: string;
  pedido_original_id: string;
  chave_acesso_original?: string | null;
  cliente_id?: string | null;
  cliente_nome?: string | null;
  cliente_whatsapp?: string | null;
  cliente_endereco?: string | null;
  codigo_postagem_reversa?: string | null;
  modo_expedicao: TdModoExpedicao;
  status: TdStatus;
  vendedora_troca_id?: string | null;
  devolvidos: ExchangeItemInput[];
  reposicoes: ReposicaoItemInput[];
}

export interface CreateExchangeResult {
  id: string;
  codigo_devolucao: string;
}

/** Mapeia o motivo -> se o item devolvido volta como vendável por padrão. */
export function motivoReposEstoquePadrao(motivo: TdMotivo): boolean {
  // Defeito/avaria: item NÃO volta ao estoque vendável (vai para avaria).
  return motivo !== "defeito_avaria";
}

export async function createNewExchange(
  params: CreateExchangeParams,
): Promise<CreateExchangeResult> {
  const {
    tipo, motivo, origem_canal, loja_origem_id, pedido_original_id,
    chave_acesso_original, cliente_id, codigo_postagem_reversa,
    modo_expedicao, status, vendedora_troca_id, devolvidos, reposicoes,
  } = params;

  // 1) evento
  const { data: evento, error: evErr } = await supabase
    .from("trocas_devolucoes")
    .insert({
      tipo,
      motivo,
      origem_canal,
      loja_origem_id,
      pedido_original_id,
      chave_acesso_original: chave_acesso_original || null,
      cliente_id: cliente_id || null,
      codigo_postagem_reversa: codigo_postagem_reversa || null,
      modo_expedicao,
      status,
      vendedora_troca_id: vendedora_troca_id || null,
    })
    .select("id, codigo_devolucao")
    .single();

  if (evErr || !evento) throw evErr || new Error("Falha ao criar troca/devolução");

  // 2) itens devolvidos + reposição
  const itensPayload = [
    ...devolvidos.map((i) => ({
      troca_devolucao_id: evento.id,
      direcao: "devolvido" as const,
      produto_id: i.produto_id || null,
      sku: i.sku || null,
      barcode: i.barcode || null,
      produto_nome: i.produto_nome || null,
      tamanho: i.tamanho || null,
      quantidade: i.quantidade,
      valor_unitario: i.valor_unitario,
      repoe_estoque: i.repoe_estoque,
      estado_estoque: null,
    })),
    ...reposicoes.map((i) => ({
      troca_devolucao_id: evento.id,
      direcao: "reposicao" as const,
      produto_id: i.produto_id || null,
      sku: i.sku || null,
      barcode: i.barcode || null,
      produto_nome: i.produto_nome || null,
      tamanho: i.tamanho || null,
      quantidade: i.quantidade,
      valor_unitario: i.valor_unitario,
      repoe_estoque: false,
      estado_estoque: i.estado_estoque,
    })),
  ];

  if (itensPayload.length > 0) {
    const { error: itErr } = await supabase
      .from("trocas_devolucoes_itens")
      .insert(itensPayload);
    if (itErr) throw itErr;
  }

  return { id: evento.id, codigo_devolucao: evento.codigo_devolucao || "" };
}

const MOTIVO_LABELS: Record<TdMotivo, string> = {
  defeito_avaria: "Defeito / Avaria",
  tamanho: "Tamanho errado",
  arrependimento: "Arrependimento",
  erro_expedicao: "Erro de expedição",
  outro: "Outro",
};

/** Gera e abre o PDF da etiqueta/instrução de devolução para enviar ao cliente. */
export function generateExchangeLabelPdf(
  params: CreateExchangeParams & { codigo_devolucao: string },
) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 50;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Banana Calçados", M, y);
  doc.setFontSize(13);
  doc.setTextColor(120);
  doc.text(
    params.tipo === "troca" ? "Instrução de Troca" : "Instrução de Devolução",
    W - M,
    y,
    { align: "right" },
  );
  doc.setTextColor(0);
  y += 24;

  doc.setDrawColor(220);
  doc.line(M, y, W - M, y);
  y += 24;

  // Código de devolução em destaque
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(params.codigo_devolucao || "—", M, y);
  y += 26;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const info = (label: string, value?: string | null) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}: `, M, y);
    const lw = doc.getTextWidth(`${label}: `);
    doc.setFont("helvetica", "normal");
    doc.text(value || "—", M + lw, y);
    y += 18;
  };

  info("Loja de origem", params.loja_nome);
  info("Cliente", params.cliente_nome);
  info("WhatsApp", params.cliente_whatsapp);
  info("Motivo", MOTIVO_LABELS[params.motivo]);
  if (params.codigo_postagem_reversa) info("Postagem reversa", params.codigo_postagem_reversa);
  info(
    "Modo de expedição",
    params.modo_expedicao === "despacho_antecipado"
      ? "Despacho antecipado"
      : "Aguarda retorno",
  );

  y += 8;
  doc.setDrawColor(220);
  doc.line(M, y, W - M, y);
  y += 22;

  // Itens devolvidos
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Itens a devolver", M, y);
  y += 20;

  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text("Produto", M, y);
  doc.text("Tam.", W - M - 120, y);
  doc.text("Qtd", W - M - 60, y);
  doc.text("Valor", W - M, y, { align: "right" });
  doc.setTextColor(0);
  y += 6;
  doc.line(M, y, W - M, y);
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const it of params.devolvidos) {
    const nome = `${it.produto_nome || it.sku || "Produto"}${it.sku ? ` (${it.sku})` : ""}`;
    const lines = doc.splitTextToSize(nome, W - M - 220);
    doc.text(lines, M, y);
    doc.text(it.tamanho || "—", W - M - 120, y);
    doc.text(String(it.quantidade), W - M - 60, y);
    doc.text(`R$ ${(it.valor_unitario * it.quantidade).toFixed(2)}`, W - M, y, { align: "right" });
    y += Math.max(16, lines.length * 12);
    if (y > 760) { doc.addPage(); y = 50; }
  }

  // Reposição (troca)
  if (params.reposicoes.length > 0) {
    y += 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Produtos de reposição (troca)", M, y);
    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const it of params.reposicoes) {
      const nome = `${it.produto_nome || it.sku || "Produto"}${it.sku ? ` (${it.sku})` : ""}`;
      const lines = doc.splitTextToSize(nome, W - M - 220);
      doc.text(lines, M, y);
      doc.text(it.tamanho || "—", W - M - 120, y);
      doc.text(String(it.quantidade), W - M - 60, y);
      y += Math.max(16, lines.length * 12);
      if (y > 760) { doc.addPage(); y = 50; }
    }
  }

  y += 20;
  if (y > 700) { doc.addPage(); y = 50; }
  doc.setDrawColor(220);
  doc.line(M, y, W - M, y);
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Como devolver:", M, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const steps = [
    "1. Coloque o(s) produto(s) na embalagem original, sem uso e com etiquetas.",
    "2. Anexe esta folha dentro da caixa.",
    params.codigo_postagem_reversa
      ? `3. Poste usando o código de postagem reversa: ${params.codigo_postagem_reversa}.`
      : "3. Aguarde as instruções de postagem enviadas pela nossa equipe.",
    "4. Guarde o comprovante de postagem até a conclusão da troca/devolução.",
  ];
  for (const s of steps) {
    const lines = doc.splitTextToSize(s, W - M * 2);
    doc.text(lines, M, y);
    y += lines.length * 14 + 4;
  }

  doc.save(`${params.codigo_devolucao || "devolucao"}.pdf`);
}

export { MOTIVO_LABELS };
