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
