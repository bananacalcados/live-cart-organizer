/** Quem entra só pela Expedição não recebe as demais áreas do PDV. */
export function isExpeditionOnly(modules: string[]): boolean {
  return modules.includes("expedition") && !modules.includes("pos");
}

export function allowedPOSSections<T extends string>(modules: string[], sections: T[]): T[] {
  return isExpeditionOnly(modules) ? sections.filter((section) => section === "expedition") : sections;
}

/** Seção inicial do PDV pela URL. expedition/transfer como sempre; as demais só as que o
 *  "Ver versão completa" do celular abre. Config nunca (exige PIN). Sem parâmetro = dashboard. */
const URL_SECTIONS = ["expedition", "transfer", "sales", "cash", "whatsapp", "customers", "returns", "dashboard"] as const;
export function initialPOSSection(search: string): string {
  const q = new URLSearchParams(search).get("section");
  return q && (URL_SECTIONS as readonly string[]).includes(q) ? q : "dashboard";
}
