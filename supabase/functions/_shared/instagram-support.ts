export type InstagramSupportCommentKind = "rastreio" | "troca_devolucao" | null;

const normalize = (value: string) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Regras determinísticas: comentário de suporte nunca depende de classificação por IA. */
export function instagramSupportCommentKind(value: string): InstagramSupportCommentKind {
  const text = normalize(value);
  if (!text) return null;
  if (/\b(quero|preciso|como|posso|qual)\b.{0,45}\b(trocar|troca|devolver|devolucao|estornar|estorno|reembolsar|reembolso)\b/.test(text)
    || /\b(troca|devolucao|estorno|reembolso)\b.{0,30}\b(como|quando|onde|prazo|procedimento)\b/.test(text)) return "troca_devolucao";
  if (/\b(cade|rastreio|rastrear|atrasad[ao])\b/.test(text)
    || /\b(comprei|pedido|compra|encomenda)\b.{0,60}\b(nao chegou|nao recebi|nao esta aparecendo|nao aparece|aparecendo|aparece)\b/.test(text)
    || /\b(nao chegou|nao recebi|minha compra nao|meu pedido nao)\b/.test(text)) return "rastreio";
  return null;
}

export function normalizeInstagramHandle(value: string | null | undefined): string {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

export function instagramWhatsappLink(phone: string | null | undefined, handle: string | null | undefined): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 13) return null;
  const username = normalizeInstagramHandle(handle);
  const text = `Oi! Vim pelo Instagram${username ? ` @${username}` : ""} e preciso de ajuda com meu pedido.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function instagramDmHandoff(nome: string | null, phone: string | null | undefined, handle: string | null | undefined, askIdentification: boolean): string {
  const link = instagramWhatsappLink(phone, handle);
  const greeting = `Oi${nome ? `, ${nome}` : ""}!`;
  if (!link) return `${greeting} Para localizar seu pedido com segurança, me passa seu WhatsApp ou CPF aqui no direct, por favor?`;
  return `${greeting} Para cuidar do seu pedido, chama a gente no WhatsApp: ${link}${askIdentification ? "\nSe preferir, pode me passar seu WhatsApp ou CPF aqui no direct." : ""}`;
}

export function instagramSupportCommentMessage(handle: string | null | undefined, phone: string | null | undefined): string {
  const username = normalizeInstagramHandle(handle);
  const link = instagramWhatsappLink(phone, username);
  const greeting = `Oi${username ? `, @${username}` : ""}! Vi seu comentário.`;
  return link
    ? `${greeting} Para cuidar do seu pedido, chama a gente no WhatsApp: ${link}`
    : `${greeting} Para cuidar do seu pedido, chama a gente aqui no direct, por favor.`;
}
