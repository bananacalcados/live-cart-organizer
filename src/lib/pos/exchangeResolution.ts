export type ExchangeResolution = "voucher" | "estorno_financeiro";

/**
 * Escolha inicial do ressarcimento. Uma decisão já gravada sempre prevalece;
 * sem decisão, devolução começa com estorno e troca mantém o padrão atual.
 */
export function initialExchangeResolution(
  tipo: "troca" | "devolucao",
  saved?: string | null,
): ExchangeResolution {
  if (saved === "voucher" || saved === "estorno_financeiro") return saved;
  const currentDefault: Record<"troca" | "devolucao", ExchangeResolution> = {
    troca: "estorno_financeiro",
    devolucao: "estorno_financeiro",
  };
  return currentDefault[tipo];
}
