/** Texto do motivo de um código de produto não estar ok na Shopify (null quando ok). */
export const CODE_STATUS_LABEL: Record<string, string> = {
  ok: "ok",
  partial_sizes: "tamanhos parciais na Shopify",
  product_missing: "produto inativo ou inexistente na Shopify",
  not_published_lovable: "não publicado no canal Lovable",
  color_missing: "cor não existe na Shopify",
  unlinked: "sem vínculo com a Shopify",
  pending_check: "aguardando verificação na Shopify",
};

export function codeStatusReason(row: { shopify_ok?: boolean | null; shopify_status?: string | null; shopify_sizes_ok?: number | null; shopify_sizes_total?: number | null }): string | null {
  if (row.shopify_ok) return null;
  const st = row.shopify_status || "pending_check";
  if (st === "partial_sizes") return `só ${row.shopify_sizes_ok ?? 0} de ${row.shopify_sizes_total ?? 0} tamanhos na Shopify`;
  return CODE_STATUS_LABEL[st] || st;
}
