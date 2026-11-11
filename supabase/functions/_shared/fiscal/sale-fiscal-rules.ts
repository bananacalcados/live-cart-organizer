// Regras fiscais puras (sem rede) compartilhadas por nfce-emitir e nfe-emitir.
export const ONLINE_SALE_TYPES = ["live", "online"];
export const ONLINE_CHANNELS = ["site", "live", "link_online", "online", "whatsapp"];
export const ONLINE_NFCE_MESSAGE = "Venda online: emita NF-e na Expedição";
export const MISSING_CUSTOMER_MESSAGE = "Falta CPF/endereço da cliente — complete o cadastro";

export interface SaleChannelInfo {
  sale_type?: string | null;
  sales_channel?: string | null;
  is_store_pickup?: boolean | null;
  source_order_id?: string | null;
}

/** Venda online/live/link/WhatsApp ou retirada de pedido online: nunca NFC-e. */
export function isOnlineSale(s: SaleChannelInfo | null | undefined): boolean {
  if (!s) return false;
  const t = String(s.sale_type || "").toLowerCase();
  const c = String(s.sales_channel || "").toLowerCase();
  return ONLINE_SALE_TYPES.includes(t) || ONLINE_CHANNELS.includes(c) || !!s.is_store_pickup || !!s.source_order_id;
}

function onlyDigits(v: unknown) { return String(v ?? "").replace(/\D/g, ""); }

export function isValidCpfDigits(v: unknown): boolean {
  const cpf = onlyDigits(v);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

/** Lista o que falta (CPF, UF, município, bairro, CEP) para NF-e de venda online. Sem fallback inventado. */
export function missingOnlineCustomerData(input: {
  cpf?: string | null; uf?: string | null; city?: string | null; neighborhood?: string | null; cep?: string | null;
}): string[] {
  const miss: string[] = [];
  if (!isValidCpfDigits(input.cpf)) miss.push("CPF");
  if (!/^[A-Z]{2}$/.test(String(input.uf || "").trim().toUpperCase())) miss.push("UF");
  if (String(input.city || "").trim().length < 2) miss.push("município");
  if (String(input.neighborhood || "").trim().length < 2) miss.push("bairro");
  if (onlyDigits(input.cep).length !== 8) miss.push("CEP");
  return miss;
}
