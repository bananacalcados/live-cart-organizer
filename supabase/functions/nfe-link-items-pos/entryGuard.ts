export type InvoiceRef = { invoice_number?: string | null; nfe_key?: string | null } | null | undefined;
export type ItemRef = { id: string; line_number?: number | null; linked_at?: string | null };

/** Motivo padrão do ajuste — também serve de chave de idempotência por nota + item. */
export function entryReason(inv: InvoiceRef, it: ItemRef): string {
  const nota = inv?.invoice_number || inv?.nfe_key || "sem-numero";
  const n = it.line_number ?? it.id;
  return `Entrada NF ${nota} item ${n}`;
}

/** Item já deu entrada se a linha já está vinculada ou se já existe ajuste com a mesma chave. */
export function alreadyEntered(it: ItemRef, reason: string, existingReasons: Set<string>): boolean {
  return !!it.linked_at || existingReasons.has(reason);
}
