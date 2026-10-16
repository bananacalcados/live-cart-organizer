export function validAustpayPaymentProof(input: {
  environment: string;
  responseOk: boolean;
  transactionId: string;
  expectedTransactionId: string;
  reference: string;
  expectedReference: string;
  status: string;
  amountCents: number;
  expectedAmountCents: number;
}): boolean {
  return input.environment === "production" && input.responseOk
    && input.transactionId === input.expectedTransactionId
    && input.reference === input.expectedReference
    && input.status === "APPROVED"
    && input.amountCents > 0
    && input.amountCents === input.expectedAmountCents;
}

export function cachedPaymentResponse(gateway: string | null) {
  return {
    success: false,
    pending: true,
    already_processing: true,
    gateway,
    error: "Existe uma aprovação anterior que precisa ser conferida. Não faça outra cobrança até confirmar o pagamento.",
  };
}