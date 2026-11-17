/**
 * Rótulos de COR e TAMANHO usados na Conferência da Expedição.
 *
 * O cadastro costuma gravar a cor já com o tamanho colado no fim
 * (ex.: "Branco Off / 37"). Na conferência os dois campos aparecem em
 * blocos separados e grandes, então a cor é mostrada sem a repetição do
 * tamanho — nunca inventando texto: se o final não for o tamanho do item,
 * a variação inteira continua aparecendo.
 */

/** Valor numérico do tamanho, para comparar formas diferentes de escrever. */
function sizeDigits(value: string | null | undefined): string {
  const raw = (value ?? "").replace(/[^\d.,]/g, "");
  if (!raw) return "";
  const num = Number(raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(num) ? String(num) : raw;
}

/**
 * Devolve a parte de COR da variação. Remove um sufixo de tamanho
 * ("/ 37", "| 38", "36") apenas quando ele bate com o tamanho do item.
 */
export function variantColorLabel(
  variantName: string | null | undefined,
  size: string | null | undefined,
): string {
  const raw = (variantName ?? "").trim();
  if (!raw) return "";

  const itemSize = sizeDigits(size);
  if (!itemSize) return raw;

  const cut = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("|"), raw.lastIndexOf("\\"));
  if (cut > 0) {
    const head = raw.slice(0, cut).trim();
    const tail = raw.slice(cut + 1).trim();
    if (head && tail && sizeDigits(tail) === itemSize) return head;
    return raw;
  }

  // Sem separador: "Preto 38" só vira "Preto" quando o número final é o tamanho.
  const spaced = raw.match(/^(.*\D)[\s.\-]+(\d+(?:[.,]\d+)?)$/);
  if (spaced && sizeDigits(spaced[2]) === itemSize) return spaced[1].trim();

  return raw;
}

/** Rótulo do tamanho, com aviso quando o cadastro não tem o número. */
export function sizeDisplayLabel(size: string | null | undefined): string {
  const raw = (size ?? "").trim();
  return raw || "SEM TAMANHO";
}
