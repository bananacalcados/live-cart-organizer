/** Link da vitrine pública do catálogo da live (Grupos VIP). */
export function buildPublicCatalogUrl(base: string, slug: string, opts: { productId?: string | null; groupId?: string | null; campaign?: string | null } = {}) {
  const q = new URLSearchParams();
  if (opts.productId) q.set("p", opts.productId);
  if (opts.groupId || opts.campaign) q.set("utm_source", "grupo");
  const c = (opts.campaign || "").trim();
  if (c) q.set("utm_campaign", c);
  if (opts.groupId) q.set("g", opts.groupId);
  const s = q.toString();
  return `${base.replace(/\/$/, "")}/pedido/${slug}/vitrine${s ? `?${s}` : ""}`;
}

/** Validade: N horas a partir de um momento, em ISO. */
export function publicCatalogUntil(from: Date, hours: number) {
  return new Date(from.getTime() + hours * 3600_000).toISOString();
}
