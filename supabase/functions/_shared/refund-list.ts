/** List visibility is gated by mp-refund authentication, never by requester. */
export const REFUND_LIST_STATUSES: Record<string, string[]> = {
  pending: ["aguardando_aprovacao"],
  active: ["processando", "verificar"],
  history: ["concluido", "concluido_manual", "recusado", "falhou"],
  failed: ["falhou"],
};

export function applyRefundListFilters(query: any, params: any) {
  let statuses = REFUND_LIST_STATUSES[params.scope];
  if (params.scope === "history" && typeof params.status === "string" && statuses.includes(params.status)) statuses = [params.status];
  if (params.scope === "history" && params.status === "concluido") statuses=["concluido","concluido_manual"];
  if (params.scope === "history" && params.show_failures !== true && params.status !== "falhou") statuses=statuses.filter(s=>s!=="falhou");
  let q = query.in("status", statuses);
  if (params.channel === "live") q = q.eq("source", "order");
  if (params.channel === "pdv") q = q.eq("source", "pos_sale");
  const from = typeof params.from === "string" && !isNaN(Date.parse(params.from)) ? new Date(params.from).toISOString() : null;
  const to = typeof params.to === "string" && !isNaN(Date.parse(params.to)) ? new Date(params.to).toISOString() : null;
  if (from || to) {
    // Data do estorno = quando foi realizado (concluído/aprovado); sem isso, quando foi pedido.
    const range = (col: string) => [from ? `${col}.gte.${from}` : "", to ? `${col}.lte.${to}` : ""].filter(Boolean).join(",");
    q = q.or(`and(${range("completed_at")}),and(completed_at.is.null,${range("approved_at")}),and(completed_at.is.null,approved_at.is.null,${range("created_at")})`);
  }
  return q.order("created_at", { ascending: false }).order("id", { ascending: false });
}