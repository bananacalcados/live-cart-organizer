/**
 * Pagamento dividido: um pedido, várias partes (Pix / Crédito / Débito).
 * Desconto Pix vale SOMENTE sobre a parte Pix. Cartão sem desconto.
 */
export type SplitMethod = "pix" | "credit" | "debit";

export interface SplitPartInput {
  method: SplitMethod;
  amount: number; // valor do pedido coberto por esta parte (antes do desconto)
  installments?: number;
}

export interface SplitPart extends SplitPartInput {
  seq: number;
  discount_amount: number;
  charge_amount: number; // o que a cliente efetivamente paga nesta parte
  installments: number;
}

export const MIN_SPLIT_PARTS = 2;
export const MAX_SPLIT_PARTS = 4;
export const DEFAULT_PIX_DISCOUNT_PCT = 5;
export const MIN_PART_AMOUNT = 1;

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export const SPLIT_METHOD_LABEL: Record<SplitMethod, string> = {
  pix: "Pix",
  credit: "Crédito",
  debit: "Débito",
};

/** Ajusta a última parte para cobrir exatamente o restante do total. */
export function rebalanceLastPart(total: number, parts: SplitPartInput[]): SplitPartInput[] {
  if (parts.length === 0) return parts;
  const head = parts.slice(0, -1);
  const used = round2(head.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const last = { ...parts[parts.length - 1], amount: round2(Math.max(0, total - used)) };
  return [...head, last];
}

export function buildSplitParts(
  parts: SplitPartInput[],
  pixDiscountPct = DEFAULT_PIX_DISCOUNT_PCT,
): SplitPart[] {
  return parts.map((p, i) => {
    const amount = round2(Number(p.amount) || 0);
    const discount = p.method === "pix" ? round2(amount * (pixDiscountPct / 100)) : 0;
    const installments = p.method === "credit" ? Math.max(1, Math.floor(p.installments || 1)) : 1;
    return {
      seq: i + 1,
      method: p.method,
      amount,
      discount_amount: discount,
      charge_amount: round2(amount - discount),
      installments,
    };
  });
}

export interface SplitValidation {
  ok: boolean;
  errors: string[];
}

export function validateSplit(total: number, parts: SplitPartInput[], maxInstallments = 6): SplitValidation {
  const errors: string[] = [];
  if (parts.length < MIN_SPLIT_PARTS) errors.push(`Use pelo menos ${MIN_SPLIT_PARTS} formas.`);
  if (parts.length > MAX_SPLIT_PARTS) errors.push(`Máximo de ${MAX_SPLIT_PARTS} formas.`);
  parts.forEach((p, i) => {
    if (!(Number(p.amount) >= MIN_PART_AMOUNT)) errors.push(`Parte ${i + 1}: valor mínimo R$ ${MIN_PART_AMOUNT},00.`);
    if (p.method === "credit" && (p.installments || 1) > maxInstallments)
      errors.push(`Parte ${i + 1}: máximo ${maxInstallments}x.`);
    if (p.method !== "credit" && (p.installments || 1) > 1) errors.push(`Parte ${i + 1}: só crédito parcela.`);
  });
  const sum = round2(parts.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  if (Math.abs(sum - round2(total)) > 0.009)
    errors.push(`A soma das partes (R$ ${sum.toFixed(2)}) precisa ser igual ao total (R$ ${round2(total).toFixed(2)}).`);
  return { ok: errors.length === 0, errors };
}

export function splitCustomerTotal(parts: SplitPart[]): number {
  return round2(parts.reduce((a, p) => a + p.charge_amount, 0));
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Texto curto: "Pix R$ 200,00 (R$ 190,00 com desconto) + Crédito R$ 260,00 em até 6x" */
export function describeSplit(parts: SplitPart[]): string {
  return parts
    .map((p) => {
      const base = `${SPLIT_METHOD_LABEL[p.method]} ${BRL(p.amount)}`;
      if (p.method === "pix" && p.discount_amount > 0) return `${base} (${BRL(p.charge_amount)} com desconto)`;
      if (p.method === "credit" && p.installments > 1) return `${base} em até ${p.installments}x`;
      return base;
    })
    .join(" + ");
}
