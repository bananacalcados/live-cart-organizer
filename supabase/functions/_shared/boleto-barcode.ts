// Utilitários de boleto bancário: linha digitável (47 dígitos) a partir do
// código de barras (44 dígitos) e desenho do código de barras ITF (Interleaved 2 of 5).
//
// O Mercado Pago devolve em `barcode.content` os 44 dígitos do CÓDIGO DE BARRAS,
// que NÃO é a linha digitável — o cliente não consegue digitar esse número no
// app do banco. A linha digitável precisa ser calculada (blocos + DVs mod10).

export function onlyDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** DV módulo 10 (pesos 2,1 da direita para a esquerda). */
function mod10(block: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = block.length - 1; i >= 0; i--) {
    let n = Number(block[i]) * weight;
    if (n > 9) n = Math.floor(n / 10) + (n % 10);
    sum += n;
    weight = weight === 2 ? 1 : 2;
  }
  const rest = sum % 10;
  return rest === 0 ? 0 : 10 - rest;
}

/**
 * Converte o código de barras de 44 dígitos na linha digitável de 47 dígitos.
 * Retorna null se o input não tiver 44 dígitos (ex.: boleto de arrecadação/concessionária).
 */
export function barcodeToDigitableLine(barcode: string): string | null {
  const b = onlyDigits(barcode);
  if (b.length !== 44) return null;

  const bank = b.slice(0, 3);
  const currency = b.slice(3, 4);
  const dvGeral = b.slice(4, 5);
  const factorAndValue = b.slice(5, 19); // 4 fator + 10 valor
  const free = b.slice(19); // 25 dígitos campo livre

  const f1 = `${bank}${currency}${free.slice(0, 5)}`;
  const f2 = free.slice(5, 15);
  const f3 = free.slice(15, 25);

  return `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${dvGeral}${factorAndValue}`;
}

/** Formata a linha digitável de 47 dígitos no padrão bancário legível. */
export function formatDigitableLine(line: string): string {
  const d = onlyDigits(line);
  if (d.length !== 47) return line;
  return (
    `${d.slice(0, 5)}.${d.slice(5, 10)} ` +
    `${d.slice(10, 15)}.${d.slice(15, 21)} ` +
    `${d.slice(21, 26)}.${d.slice(26, 32)} ` +
    `${d.slice(32, 33)} ` +
    `${d.slice(33)}`
  );
}

/** Barras ITF (Interleaved 2 of 5) — true = barra, false = espaço; largura em módulos. */
const ITF_PATTERNS: Record<string, string> = {
  "0": "nnwwn",
  "1": "wnnnw",
  "2": "nwnnw",
  "3": "wwnnn",
  "4": "nnwnw",
  "5": "wnwnn",
  "6": "nwwnn",
  "7": "nnnww",
  "8": "wnnwn",
  "9": "nwnwn",
};

export interface ItfBar {
  /** deslocamento horizontal em módulos */
  offset: number;
  /** largura em módulos */
  width: number;
}

/**
 * Gera a lista de barras (só as pretas) do código ITF para uma sequência de
 * dígitos de tamanho par (o código de barras de boleto tem 44).
 */
export function itfBars(digits: string): { bars: ItfBar[]; totalModules: number } {
  let d = onlyDigits(digits);
  if (d.length % 2 !== 0) d = `0${d}`;

  const bars: ItfBar[] = [];
  let offset = 0;
  const push = (isBar: boolean, width: number) => {
    if (isBar) bars.push({ offset, width });
    offset += width;
  };

  // Start: barra fina, espaço fino, barra fina, espaço fino
  push(true, 1); push(false, 1); push(true, 1); push(false, 1);

  for (let i = 0; i < d.length; i += 2) {
    const barsPat = ITF_PATTERNS[d[i]];
    const spacesPat = ITF_PATTERNS[d[i + 1]];
    if (!barsPat || !spacesPat) continue;
    for (let k = 0; k < 5; k++) {
      push(true, barsPat[k] === "w" ? 3 : 1);
      push(false, spacesPat[k] === "w" ? 3 : 1);
    }
  }

  // Stop: barra larga, espaço fino, barra fina
  push(true, 3); push(false, 1); push(true, 1);

  return { bars, totalModules: offset };
}
