/** Quem entra só pela Expedição não recebe as demais áreas do PDV. */
export function isExpeditionOnly(modules: string[]): boolean {
  return modules.includes("expedition") && !modules.includes("pos");
}

export function allowedPOSSections<T extends string>(modules: string[], sections: T[]): T[] {
  return isExpeditionOnly(modules) ? sections.filter((section) => section === "expedition") : sections;
}
