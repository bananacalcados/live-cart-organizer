/** List visibility is gated by mp-refund authentication, never by requester. */
export const REFUND_LIST_STATUSES: Record<string, string[]> = {
  pending: ["aguardando_aprovacao"],
  active: ["processando", "verificar"],
  history: ["concluido", "concluido_manual", "recusado", "falhou"],
};

export function applyRefundListFilters(query: any, params: any) {
  let statuses = REFUND_LIST_STATUSES[params.scope];
  if (params.scope === "history" && typeof params.status === "string" && statuses.includes(params.status)) statuses = [params.status];
  if (params.scope === "history" && params.status === "concluido") statuses=["concluido","concluido_manual"];
  if (params.scope === "history" && params.show_failures !== true && params.status !== "falhou") statuses=statuses.filter(s=>s!=="falhou");
  let q = query.in("status", statuses);
  if (params.channel === "live") q = q.eq("source", "order");
  if (params.channel === "pdv") q = q.eq("source", "pos_sale");
  if (typeof params.from === "string" && !isNaN(Date.parse(params.from))) q = q.gte("created_at", params.from);
  if (typeof params.to === "string" && !isNaN(Date.parse(params.to))) q = q.lte("created_at", params.to);
  return q.order("created_at", { ascending: false }).order("id", { ascending: false });
}