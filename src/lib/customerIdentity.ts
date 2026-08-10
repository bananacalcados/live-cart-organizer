/**
 * Identidade do cliente para pagamentos.
 *
 * Gateways (Pagar.me, Mercado Pago, AppMax) pontuam antifraude com base na
 * consistência do `payer`. Enviar o @ do Instagram como "nome do cliente" ou um
 * e-mail obviamente falso derruba a aprovação. Estes helpers garantem que só
 * nome real e e-mail plausível cheguem ao gateway.
 */

const JUNK_LOCAL_PARTS = new Set([
  "asd", "asdf", "teste", "test", "aaa", "abc", "123", "xxx", "naotenho",
  "semmail", "sememail", "nao", "email", "a", "aa", "qwe", "qwerty",
]);

/** Nome real = 2+ palavras, só letras, sem @, sem números. */
export function isRealFullName(raw?: string | null): boolean {
  const v = String(raw ?? "").trim();
  if (!v || v.includes("@") || /\d/.test(v)) return false;
  if (/[._]/.test(v)) return false; // "amalia.ferraz" é handle, não nome
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((p) => /^[a-zA-ZÀ-ÿ'’-]{2,}$/.test(p));
}

/** Divide em primeiro/último nome já higienizados. */
export function splitFullName(raw?: string | null): { firstName: string; lastName: string } {
  const parts = String(raw ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

/** E-mail sintaticamente válido e sem cara de lixo ("asd@gmail.com"). */
export function isUsableEmail(raw?: string | null): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) return false;
  const local = v.split("@")[0];
  if (local.length < 4) return false;
  if (JUNK_LOCAL_PARTS.has(local)) return false;
  if (/^(.)\1+$/.test(local)) return false; // "aaaa@..."
  return true;
}
