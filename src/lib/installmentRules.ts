// ── Regras de parcelamento (por link / por evento / padrão geral) ──────────
// Regra de ouro: quando um LINK (venda do PDV/WhatsApp) ou um PEDIDO traz sua
// própria regra, ela SUBSTITUI o padrão geral — pode apertar, não só afrouxar.
// O "sem juros" também é NOSSO: mesmo que o Mercado Pago absorva juros até 10x
// na conta, acima do limite do link cobramos acréscimo pela nossa tabela.

export interface InstallmentConfig {
  max_installments: number;
  interest_free_installments: number;
  monthly_interest_rate: number;
  /** Abaixo deste valor a parcela nem aparece (0/undefined = sem mínimo) */
  min_installment_value?: number;
}

export const DEFAULT_INSTALLMENT_CONFIG: InstallmentConfig = {
  max_installments: 12,
  interest_free_installments: 6,
  monthly_interest_rate: 2.49,
};

/** Lê uma regra vinda do banco (jsonb) e devolve null quando não há regra útil. */
export function parseInstallmentRule(raw: any): InstallmentConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const max = Number(raw.max_installments);
  const free = raw.interest_free_installments === null || raw.interest_free_installments === undefined
    ? null
    : Number(raw.interest_free_installments);
  const rate = Number(raw.monthly_interest_rate);
  const minVal = Number(raw.min_installment_value);
  if (!Number.isFinite(max) && free === null) return null;
  const maxFinal = Number.isFinite(max) && max > 0
    ? Math.min(12, Math.max(1, Math.round(max)))
    : DEFAULT_INSTALLMENT_CONFIG.max_installments;
  const freeFinal = free !== null && Number.isFinite(free) && free >= 0
    ? Math.min(maxFinal, Math.round(free))
    : maxFinal;
  return {
    max_installments: maxFinal,
    interest_free_installments: freeFinal,
    monthly_interest_rate: Number.isFinite(rate) && rate >= 0
      ? rate
      : DEFAULT_INSTALLMENT_CONFIG.monthly_interest_rate,
    min_installment_value: Number.isFinite(minVal) && minVal > 0 ? minVal : undefined,
  };
}

export function calculateInstallmentAmount(total: number, installments: number, config: InstallmentConfig) {
  if (installments <= config.interest_free_installments) {
    return { installmentValue: total / installments, totalWithInterest: total, hasInterest: false };
  }
  const rate = (config.monthly_interest_rate || 0) / 100;
  const totalWithInterest = Math.round(total * Math.pow(1 + rate, installments) * 100) / 100;
  return {
    installmentValue: totalWithInterest / installments,
    totalWithInterest,
    hasInterest: rate > 0,
  };
}

export interface MpPayerCost {
  installments: number;
  installmentAmount: number;
  totalAmount: number;
  interestFree: boolean;
}

export interface InstallmentOption {
  installments: number;
  installmentAmount: number;
  /** Total que o cliente realmente paga */
  totalAmount: number;
  /** Valor a enviar ao gateway (inflado quando o acréscimo é nosso) */
  chargeAmount: number;
  hasInterest: boolean;
  label: string;
}

/**
 * Monta a lista de parcelas respeitando a regra do link.
 * - Dentro do "sem juros" do link: cobra o total cheio (ou o que o MP informar,
 *   se o emissor cobrar juros mesmo assim).
 * - Acima do "sem juros" do link: acréscimo NOSSO, ignorando o "sem juros" da
 *   conta do Mercado Pago (o valor enviado ao gateway já vai com o acréscimo).
 */
export function buildInstallmentOptions(
  amount: number,
  config: InstallmentConfig,
  mpOptions?: MpPayerCost[] | null,
): InstallmentOption[] {
  const out: InstallmentOption[] = [];
  const maxN = Math.max(1, Math.min(12, config.max_installments || 1));
  for (let i = 1; i <= maxN; i++) {
    const mp = mpOptions?.find((o) => o.installments === i) || null;
    if (mpOptions && mpOptions.length > 0 && !mp) continue; // emissor não oferece

    let totalAmount: number;
    let chargeAmount: number;
    let hasInterest: boolean;

    if (i <= config.interest_free_installments) {
      if (mp && !mp.interestFree) {
        totalAmount = mp.totalAmount; chargeAmount = amount; hasInterest = true;
      } else {
        totalAmount = amount; chargeAmount = amount; hasInterest = false;
      }
    } else if (mp && !mp.interestFree) {
      // O próprio Mercado Pago já cobra juros nessa parcela — não inflamos nada.
      totalAmount = mp.totalAmount; chargeAmount = amount; hasInterest = true;
    } else {
      const calc = calculateInstallmentAmount(amount, i, config);
      totalAmount = calc.totalWithInterest; chargeAmount = calc.totalWithInterest; hasInterest = calc.hasInterest;
    }

    const installmentAmount = totalAmount / i;
    if (i > 1 && config.min_installment_value && installmentAmount < config.min_installment_value) continue;

    const label = i === 1
      ? `1x de R$ ${amount.toFixed(2)} (à vista)`
      : `${i}x de R$ ${installmentAmount.toFixed(2)}${hasInterest ? ` (total R$ ${totalAmount.toFixed(2)} com acréscimo)` : " sem juros"}`;

    out.push({ installments: i, installmentAmount, totalAmount, chargeAmount, hasInterest, label });
  }
  if (out.length === 0) {
    out.push({ installments: 1, installmentAmount: amount, totalAmount: amount, chargeAmount: amount, hasInterest: false, label: `1x de R$ ${amount.toFixed(2)} (à vista)` });
  }
  return out;
}
