/**
 * Decide se um número de 10/11 dígitos SEM DDI é um telefone brasileiro
 * (DDD + número). Só nesse caso o "55" deve ser adicionado.
 *
 * Motivo: números dos EUA/Canadá (+1) também têm 11 dígitos
 * (ex.: 15046165205 = +1 504 616-5205). Antes, qualquer número de 11 dígitos
 * ganhava "55" na frente e virava um telefone brasileiro inexistente.
 *
 * - 11 dígitos BR: DDD (11–99, sem zero) + 9 + 8 dígitos → 3º dígito é 9.
 * - 10 dígitos BR: DDD + 8 dígitos (fixo 2–5 ou celular antigo 6–9).
 */
export function looksLikeBrLocal(digits: string): boolean {
  if (!/^[1-9][1-9]\d+$/.test(digits)) return false;
  if (digits.length === 11) return digits[2] === "9";
  if (digits.length === 10) return /[2-9]/.test(digits[2]);
  return false;
}
