/**
 * Regras de validação de variação de produto.
 * - Tamanho (size): apenas números e caracteres especiais (/, ., -, espaço)
 *   OU whitelist de tamanhos textuais (PP, P, M, G, GG, EG, XG, XGG, U, UN, ÚNICO)
 * - Cor (color): apenas letras (acentuadas ok) e caracteres especiais; não pode ser puramente numérica.
 */

export const SIZE_TEXT_WHITELIST = [
  "PP", "P", "M", "G", "GG", "EG", "XG", "XGG",
  "U", "UN", "ÚN", "UNICO", "ÚNICO",
];

const SIZE_NUMERIC_RE = /^[0-9]+([/.,\-\s][0-9]+)*$/;
const COLOR_HAS_DIGIT_ONLY_RE = /^[\s0-9/.,\-]+$/;

/** true se a string é um tamanho aceitável. */
export function isValidSize(raw: string): boolean {
  const s = (raw || "").trim();
  if (!s) return false;
  if (SIZE_NUMERIC_RE.test(s)) return true;
  return SIZE_TEXT_WHITELIST.includes(s.toUpperCase().normalize("NFC"));
}

/** true se a string é uma cor aceitável (não pode ser só números). */
export function isValidColor(raw: string): boolean {
  const s = (raw || "").trim();
  if (!s) return false;
  if (COLOR_HAS_DIGIT_ONLY_RE.test(s)) return false;
  return true;
}

/** Sanitiza input de tamanho: remove letras fora da whitelist. */
export function sanitizeSizeInput(raw: string): string {
  const s = (raw || "").toUpperCase();
  // permite números, /, ., -, espaço
  // e mantém letras APENAS se, após remover não-letras, formar um item da whitelist
  const lettersOnly = s.replace(/[^A-ZÁÉÍÓÚÃÕÂÊÔÇ]/g, "");
  if (lettersOnly && SIZE_TEXT_WHITELIST.includes(lettersOnly)) return lettersOnly;
  return s.replace(/[^0-9/.,\-\s]/g, "");
}

/** Sanitiza input de cor: remove dígitos. */
export function sanitizeColorInput(raw: string): string {
  return (raw || "").replace(/[0-9]/g, "");
}

/** Detecta se dois campos foram invertidos e retorna a versão corrigida. */
export function autoFixSwapped(color: string, size: string): { color: string; size: string; swapped: boolean } {
  const c = (color || "").trim();
  const s = (size || "").trim();
  if (!c || !s) return { color: c, size: s, swapped: false };
  // size parece cor E color parece tamanho → swap
  if (!isValidSize(s) && isValidColor(s) && isValidSize(c) && !isValidColor(c)) {
    return { color: s, size: c, swapped: true };
  }
  return { color: c, size: s, swapped: false };
}
