// Vários pedidos: rastreio responde a situação de cada um; troca/devolução pergunta qual produto.
import type { OrderCtx, TrackingInfo } from "./support-ai.ts";

export const MULTI_ORDER_MAX = 4;
const DAY = 864e5;

/** Pedidos online pagos nos últimos 30 dias, menos os entregues há mais de 7 dias. */
export function recentTrackableOrders(orders: OrderCtx[], now: number): OrderCtx[] {
  return orders.filter((o) => o.canal === "online"
    && now - Date.parse(o.data + "T12:00:00Z") <= 30 * DAY
    && !(o.entregue_em && now - Date.parse(o.entregue_em + "T12:00:00Z") > 7 * DAY));
}

export function productSummary(o: OrderCtx, max = 45): string {
  const names = o.itens.map((i) => (i.produto || "Produto").replace(/\s+/g, " ").trim());
  let s = names[0] ? names[0].slice(0, max).trim() + (names[0].length > max ? "…" : "") : "Pedido";
  if (names.length > 1) s += ` + ${names.length - 1} ${names.length > 2 ? "itens" : "item"}`;
  return s;
}

const STAGE: Record<TrackingInfo["etapa"], string> = {
  em_separacao: "em separação", sem_envio: "em separação", separado: "separado, aguardando envio",
  enviado: "enviado", entregue: "consta como entregue",
};

/** Agrupa pedidos que saíram no mesmo link de rastreio e monta o texto. */
export function multiTrackingText(nome: string | null, rows: { order: OrderCtx; info: TrackingInfo }[]): string {
  const groups: { url: string | null; etapa: TrackingInfo["etapa"]; orders: OrderCtx[] }[] = [];
  for (const r of rows) {
    const g = r.info.url ? groups.find((x) => x.url === r.info.url) : null;
    if (g) g.orders.push(r.order); else groups.push({ url: r.info.url, etapa: r.info.etapa, orders: [r.order] });
  }
  const lines = groups.map((g) => {
    const prod = g.orders.map((o) => productSummary(o)).join(" e ");
    const together = g.orders.length > 1 ? " (foram juntos)" : "";
    return `• ${prod}${together}: ${STAGE[g.etapa]}.${g.url ? ` Acompanhe: ${g.url}` : " Assim que sair, te atualizo."}`;
  });
  const plural = rows.length > 1 ? "seus pedidos" : "seu pedido";
  return `${nome ? `Oi, ${nome}! ` : ""}Achei ${plural} 😊\n${lines.join("\n")}`.slice(0, 950);
}

export function whichProductQuestion(nome: string | null, tipo: "troca" | "devolucao" | null, orders: OrderCtx[]): string {
  const acao = tipo === "devolucao" ? "devolver" : tipo === "troca" ? "trocar" : "trocar ou devolver";
  const lines = orders.map((o) => `• ${productSummary(o)} (${o.data.split("-").reverse().slice(0, 2).join("/")})`);
  return `${nome ? `${nome}, ` : ""}qual destes produtos você quer ${acao}?\n${lines.join("\n")}`.slice(0, 950);
}
