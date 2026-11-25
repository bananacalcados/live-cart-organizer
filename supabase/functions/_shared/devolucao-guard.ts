// Trava contra NF-e de devolução em duplicidade (regra pura, testável).
// Uma venda só pode ter devoluções autorizadas cuja soma não passe do valor da nota original,
// e uma nota de devolução já existente (ex.: emitida pela reversa dos Correios) é reaproveitada
// quando o valor bate — nunca emitida de novo.

export interface ExistingDevolucao {
  id: string;
  status: string; // authorized | pending_sefaz
  valor_total: number;
  numero?: string | number | null;
  chave_acesso?: string | null;
  /** Pode ser reaproveitada por esta troca/reversa (não pertence a outra). */
  reusable: boolean;
}

export type DevolucaoDecision =
  | { action: "emit" }
  | { action: "reuse"; doc: ExistingDevolucao }
  | { action: "block"; reason: "divergente" | "excede"; message: string };

const brl = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
const TOL = 0.01;

export interface DevolucaoItemMatch {
  direcao?: string | null;
  estado_estoque?: string | null;
  sku?: string | null;
  barcode?: string | null;
  quantidade?: number | string | null;
}

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();
const conferidos = (items: DevolucaoItemMatch[]) => (items || []).filter((i) =>
  i.direcao === "devolvido" && (i.estado_estoque === "retornado_vendavel" || i.estado_estoque === "retornado_avaria"),
);

/** Mesma mercadoria e quantidade, sem depender da ordem das linhas. Sem SKU/código, não há prova suficiente. */
export function mesmaDevolucaoConferida(atuais: DevolucaoItemMatch[], anteriores: DevolucaoItemMatch[]): boolean {
  const signature = (items: DevolucaoItemMatch[]) => {
    const quantities = new Map<string, number>();
    for (const item of conferidos(items)) {
      const key = norm(item.sku) || norm(item.barcode);
      if (!key) return [] as string[];
      quantities.set(key, (quantities.get(key) || 0) + Number(item.quantidade || 0));
    }
    return [...quantities.entries()].filter(([, q]) => q > 0).sort(([a], [b]) => a.localeCompare(b)).map(([key, q]) => `${key}:${q}`);
  };
  const a = signature(atuais);
  const b = signature(anteriores);
  return a.length > 0 && a.length === b.length && a.every((line, index) => line === b[index]);
}

/** Só uma TD encerrada da mesma venda e com o mesmo retorno pode ceder sua NF a outra TD. */
export function podeReutilizarNotaDeOutraTroca(input: {
  trocaAtualId: string | null;
  pedidoOriginalId: string;
  documentoId: string;
  itensAtuais: DevolucaoItemMatch[];
  outra: {
    id: string;
    devolucao_doc_id: string | null;
    status: string;
    pedido_original_id: string | null;
    trocas_devolucoes_itens?: DevolucaoItemMatch[];
  };
}): boolean {
  const { outra } = input;
  return outra.id !== input.trocaAtualId
    && outra.devolucao_doc_id === input.documentoId
    && outra.pedido_original_id === input.pedidoOriginalId
    && (outra.status === "concluida" || outra.status === "cancelada")
    && mesmaDevolucaoConferida(input.itensAtuais, outra.trocas_devolucoes_itens || []);
}

export function decideDevolucao(input: {
  valorNovo: number;
  valorOriginal: number | null;
  existentes: ExistingDevolucao[];
}): DevolucaoDecision {
  const { valorNovo, valorOriginal, existentes } = input;
  const ativas = existentes.filter((d) => d.status === "authorized" || d.status === "pending_sefaz");
  const reusaveis = ativas.filter((d) => d.reusable && d.status === "authorized");

  const igual = reusaveis.find((d) => Math.abs(Number(d.valor_total) - valorNovo) <= TOL);
  if (igual) return { action: "reuse", doc: igual };

  if (reusaveis.length > 0) {
    const d = reusaveis[0];
    return {
      action: "block",
      reason: "divergente",
      message: `Já existe NF de devolução desta venda (nº ${d.numero ?? "?"}, ${brl(d.valor_total)}) com valor diferente dos itens conferidos (${brl(valorNovo)}) — resolver com o fiscal.`,
    };
  }

  const soma = ativas.reduce((s, d) => s + Number(d.valor_total || 0), 0);
  if (valorOriginal != null && valorOriginal > 0 && soma + valorNovo > valorOriginal + TOL) {
    return {
      action: "block",
      reason: "excede",
      message: `Esta venda já tem ${ativas.length} NF de devolução (${brl(soma)}). Emitir mais ${brl(valorNovo)} passaria do valor da nota original (${brl(valorOriginal)}) — resolver com o fiscal.`,
    };
  }
  return { action: "emit" };
}
