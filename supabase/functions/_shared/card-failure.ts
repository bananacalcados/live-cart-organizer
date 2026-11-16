export type DeclineCategory = "risk" | "card_data" | "minimum_amount" | "issuer" | "customer_data" | "unknown";

export function normalizeFailureCode(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function categorizeDecline(codeOrMessage: string): { stopCascade: boolean; declineCategory: DeclineCategory } {
  const normalized = normalizeFailureCode(codeOrMessage);
  if (!normalized) return { stopCascade: false, declineCategory: "unknown" };

  if (
    normalized.includes("bad_filled") ||
    normalized.includes("código de segurança inválido") || normalized.includes("codigo de seguranca invalido") ||
    normalized.includes("cartão inválido") || normalized.includes("cartao invalido") ||
    normalized.includes("número do cartão") || normalized.includes("numero do cartao") ||
    normalized.includes("data de validade") || normalized.includes("invalid_installments") ||
    normalized.includes("invalid card number") || normalized.includes("card number invalid") ||
    normalized.includes("invalid expiration") || normalized.includes("invalid expiry") ||
    normalized.includes("invalid cvv") || normalized.includes("invalid security code") ||
    normalized.includes("security code invalid")
  ) {
    return { stopCascade: true, declineCategory: "card_data" };
  }

  if (normalized.includes("valor inferior a r$ 5,00") || normalized.includes("parcela 1 possui o valor inferior a r$ 5,00")) {
    return { stopCascade: true, declineCategory: "minimum_amount" };
  }

  if (
    normalized.startsWith("cc_rejected_") ||
    normalized.includes("análise de segurança") || normalized.includes("analise de seguranca") ||
    normalized.includes("high_risk") || normalized.includes("antifraud") || normalized.includes("recusado_por_risco")
  ) {
    return { stopCascade: false, declineCategory: "risk" };
  }

  return { stopCascade: false, declineCategory: "unknown" };
}

/** A AppMax deve classificar a resposta original, nunca uma tradução genérica nossa. */
export function categorizeAppmaxTokenizeError(rawProviderResponse: unknown) {
  return categorizeDecline(typeof rawProviderResponse === "string" ? rawProviderResponse : JSON.stringify(rawProviderResponse || ""));
}

export function hasGatewayFallback(errors: string[], gateway: string) {
  const wanted = gateway.trim().toLowerCase();
  return errors.some((entry) => entry.split(":", 1)[0].trim().toLowerCase() === wanted);
}

export function friendlyCardFailure(
  result: { error?: string; stopCascade?: boolean; declineCategory?: DeclineCategory },
  mpDeclineRaw = "",
) {
  const cause = normalizeFailureCode(mpDeclineRaw);
  if (result.declineCategory === "card_data" || cause.includes("bad_filled") || cause.includes("código de segurança") || cause.includes("codigo de seguranca") || cause.includes("número do cartão") || cause.includes("numero do cartao") || cause.includes("data de validade")) {
    return "Confira os dados do cartão (número, validade e código de segurança), tente outro cartão ou pague no Pix (5% de desconto).";
  }
  if (cause.includes("insufficient_amount") || cause.includes("sem limite")) {
    return "Seu banco recusou por limite insuficiente para este valor. Tente um número maior de parcelas, outro cartão ou pague no Pix (5% de desconto).";
  }
  if (cause.includes("high_risk") || cause.includes("risco") || cause.includes("blacklist") || cause.includes("antifraud")) {
    return "Seu banco não autorizou esta compra por segurança. Ligue para o banco autorizando a compra, use outro cartão ou pague no Pix (5% de desconto).";
  }
  if (cause.includes("call_for_auth") || cause.includes("card_disabled") || cause.includes("cc_rejected_other_reason") || cause.includes("duplicated")) {
    return "Seu banco não autorizou esta compra. Não é erro de digitação: fale com o banco, use outro cartão ou pague no Pix (5% de desconto).";
  }
  return "Não conseguimos aprovar o pagamento com este cartão. Confira os dados, tente outro cartão ou pague no Pix (5% de desconto).";
}
