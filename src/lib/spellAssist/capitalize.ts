/**
 * capitalizeSentences — capitaliza a 1ª letra do texto e de cada nova frase
 * (após `.`, `!`, `?` ou quebra de linha).
 *
 * IMPORTANTE: transformação conservadora e idempotente que SÓ altera o case
 * (nunca insere/remove caracteres) → o comprimento do texto é preservado, então
 * a posição do cursor no textarea não é afetada ao digitar.
 */
export function capitalizeSentences(text: string): string {
  if (!text) return text;

  let result = "";
  let capitalizeNext = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (capitalizeNext && /[a-zà-ÿ]/.test(ch)) {
      result += ch.toUpperCase();
      capitalizeNext = false;
      continue;
    }

    result += ch;

    if (/[\p{L}\p{N}]/u.test(ch)) {
      // letra ou número → estamos no meio de uma palavra/frase
      capitalizeNext = false;
    } else if (/[.!?\n]/.test(ch)) {
      // fim de frase → próxima letra deve ser maiúscula
      capitalizeNext = true;
    }
    // espaços e demais símbolos mantêm o estado atual
  }

  return result;
}
