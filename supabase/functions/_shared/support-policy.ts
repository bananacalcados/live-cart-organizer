export type UnifiedMessage = { from: "cliente" | "loja"; text: string; at: string; instance_id?: string | null; instance?: string; human?: boolean };
export const CONSOLIDATION_TEXT = "Vi que você já está conversando com a gente no nosso outro número sobre esse assunto, correto? Para facilitar, vamos manter seu atendimento só por lá e finalizar a conversa neste número, tá bom?";
export function unifyMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  const unique = new Map<string, UnifiedMessage>();
  for (const m of messages) unique.set(`${m.instance_id}:${m.at}:${m.from}:${m.text}`, m);
  return [...unique.values()].sort((a, b) => a.at.localeCompare(b.at));
}
export function humanOtherInstances(messages: UnifiedMessage[], current: string | null, now: number) {
  return [...new Set(messages.filter(m => m.human && m.from === "loja" && m.instance_id && m.instance_id !== current && now - Date.parse(m.at) <= 72 * 3600000 && Date.parse(m.at) <= now).map(m => m.instance_id))];
}
export function validCpf(value: string): boolean {
  const n = value.replace(/\D/g, "");
  if (n.length !== 11 || /^(\d)\1{10}$/.test(n)) return false;
  for (let len = 9; len <= 10; len++) {
    const sum = [...n.slice(0, len)].reduce((a, d, i) => a + Number(d) * (len + 1 - i), 0);
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(n[len])) return false;
  }
  return true;
}
export const maskCpf = (n: string) => `***.***.***-${n.replace(/\D/g, "").slice(-2)}`;
export const cpfAttemptAllowed = (count: number) => count < 2;
const normal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function cpfIdentityConfirmed(conversationName: string | null, candidateName: string | null, product: string, confirmedProduct: string | null): boolean {
  if (conversationName && candidateName && normal(conversationName.split(/\s/)[0]) === normal(candidateName.split(/\s/)[0])) return true;
  return !!confirmedProduct && normal(confirmedProduct) === normal(product);
}
export type SupportFacts = { originality?: boolean; danger?: boolean; selected_ref?: string | null; insisted_return?: boolean; exchange_offer_made?: boolean; same_subject_instance?: string | null; confirmed_product?: string | null };
export function preferredLink(category: string, facts: SupportFacts, offers: number): "troca" | "devolucao" | null {
  if (facts.danger) return null;
  if (category === "troca") return "troca";
  if (category !== "devolucao") return null;
  return facts.originality || facts.insisted_return || facts.exchange_offer_made || offers >= 1 ? "devolucao" : "troca";
}