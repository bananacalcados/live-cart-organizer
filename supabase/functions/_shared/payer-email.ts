// Sanitização de e-mail do pagador para gateways (Mercado Pago, Pagar.me, etc).
// Gateways rejeitam o pagamento inteiro (400 "payer.email must be a valid email")
// quando o e-mail digitado pela cliente tem erro de digitação (ex: "@gmail.coma").
// Aqui corrigimos os erros mais comuns e, se ainda estiver inválido,
// usamos um e-mail técnico derivado do telefone/CPF para NÃO travar a cobrança.

const DOMAIN_TYPOS: Record<string, string> = {
  "gmail.coma": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.comm": "gmail.com",
  "gmail.cim": "gmail.com",
  "gmail.copm": "gmail.com",
  "gmail.c0m": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.comb": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.co": "gmail.com",
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmail.copm.br": "gmail.com",
  "hotmail.coma": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "hotmail.cm": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "outlook.con": "outlook.com",
  "outlook.coma": "outlook.com",
  "yahoo.con": "yahoo.com",
  "yahoo.coma": "yahoo.com",
  "icloud.con": "icloud.com",
  "icloud.coma": "icloud.com",
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;

/** Corrige erros de digitação comuns e normaliza (trim/lowercase/sem espaços). */
export function normalizePayerEmail(raw?: string | null): string | null {
  if (!raw) return null;
  let email = String(raw).trim().toLowerCase().replace(/\s+/g, "");
  if (!email || !email.includes("@")) return null;

  // remove pontuação final acidental
  email = email.replace(/[.,;:]+$/, "");

  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (!local || !domain) return null;

  if (DOMAIN_TYPOS[domain]) domain = DOMAIN_TYPOS[domain];
  // ".com.br" digitado como ".com.brr"/".com.b"
  domain = domain.replace(/\.com\.brr?$/, ".com.br").replace(/\.com\.b$/, ".com.br");

  const candidate = `${local}@${domain}`;
  return EMAIL_RE.test(candidate) ? candidate : null;
}

/**
 * Retorna sempre um e-mail válido para enviar ao gateway.
 * Ordem: e-mail informado (corrigido) → derivado do telefone → derivado do CPF → genérico.
 */
export function resolvePayerEmail(opts: {
  email?: string | null;
  phone?: string | null;
  cpf?: string | null;
  orderId?: string | null;
}): { email: string; fallbackUsed: boolean; original?: string | null } {
  const normalized = normalizePayerEmail(opts.email);
  if (normalized) {
    return { email: normalized, fallbackUsed: normalized !== (opts.email || "").trim().toLowerCase(), original: opts.email };
  }

  const phone = (opts.phone || "").replace(/\D/g, "");
  const cpf = (opts.cpf || "").replace(/\D/g, "");
  const base = phone || cpf || (opts.orderId || "cliente").replace(/[^a-z0-9]/gi, "").slice(0, 20) || "cliente";
  return {
    email: `${base}@cliente.bananacalcados.com.br`,
    fallbackUsed: true,
    original: opts.email ?? null,
  };
}
