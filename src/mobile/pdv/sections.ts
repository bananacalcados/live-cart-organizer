/** Abas do PDV no celular. `desktop` = seção do PDV completo aberta por "Ver versão completa". */
export type MobilePdvTab = "expedicao" | "whatsapp" | "venda" | "caixa" | "dashboard" | "clientes" | "trocas";
export const MOBILE_PDV_TABS: { id: MobilePdvTab; label: string; desktop: string; phase: number }[] = [
  { id: "expedicao", label: "Expedição", desktop: "expedition", phase: 1 },
  { id: "whatsapp", label: "WhatsApp", desktop: "whatsapp", phase: 2 },
  { id: "venda", label: "Venda", desktop: "sales", phase: 5 },
  { id: "caixa", label: "Caixa", desktop: "cash", phase: 5 },
  { id: "trocas", label: "Trocas", desktop: "returns", phase: 5 },
  { id: "clientes", label: "Clientes", desktop: "customers", phase: 6 },
  { id: "dashboard", label: "Dashboard", desktop: "dashboard", phase: 6 },
];
export const BOTTOM_TABS: MobilePdvTab[] = ["expedicao", "whatsapp", "venda", "caixa"];

export function fullVersionUrl(tab: MobilePdvTab): string {
  const t = MOBILE_PDV_TABS.find((x) => x.id === tab);
  return `/pos?section=${t?.desktop ?? "dashboard"}`;
}

/** Quem tem só Expedição vê só Expedição (mesma regra do desktop: isExpeditionOnly). */
export function visibleMobileTabs(expeditionOnly: boolean): MobilePdvTab[] {
  return expeditionOnly ? ["expedicao"] : MOBILE_PDV_TABS.map((t) => t.id);
}
