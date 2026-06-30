// Extração e validação de telefone brasileiro a partir de TEXTO LIVRE
// (ex.: comentários de live do Instagram onde a pessoa digita o WhatsApp).
//
// Garantias contra falso-positivo:
//  - exige formato de telefone (DDD + 8/9 dígitos), ignorando números soltos
//    como tamanho de calçado (33, 38) ou valores;
//  - valida o DDD contra a lista oficial de DDDs do Brasil;
//  - exige celular (9º dígito), injetando-o quando vier com 10 dígitos;
//  - retorna em E.164 (55 + DDD + número) + os últimos 4 dígitos para confirmação.

const VALID_DDDS = new Set<number>([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export interface ExtractedPhone {
  phone: string; // E.164: 55DDDNNNNNNNNN
  last4: string; // últimos 4 dígitos
}

/**
 * Procura no texto a primeira sequência que é um telefone BR válido.
 * Retorna null quando não há telefone reconhecível.
 */
export function extractBRPhone(text: string): ExtractedPhone | null {
  if (!text) return null;

  // Padrão de telefone permitindo separadores internos comuns:
  // "(33) 99999-8888", "33 99999 8888", "5533999998888", "33999998888", "+55 33 9 9999 8888"
  const re = /(?:\+?55[\s.\-]?)?\(?\d{2}\)?[\s.\-]?\d{4,5}[\s.\-]?\d{4}/g;
  const matches = text.match(re) || [];

  for (const m of matches) {
    let d = m.replace(/\D/g, "");

    // Remove DDI 55 quando vier completo (12 ou 13 dígitos)
    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
      d = d.slice(2);
    }

    // Injeta o 9º dígito em celular informado com 10 dígitos (DDD + 8)
    if (d.length === 10) {
      d = d.slice(0, 2) + "9" + d.slice(2);
    }

    if (d.length !== 11) continue;

    const ddd = parseInt(d.slice(0, 2), 10);
    if (!VALID_DDDS.has(ddd)) continue;

    // Celular precisa do 9º dígito (primeiro dígito do número = 9)
    if (d.charAt(2) !== "9") continue;

    return { phone: "55" + d, last4: d.slice(-4) };
  }

  return null;
}

/** True quando o texto contém algum dígito (usado para decidir fallback de DM). */
export function textHasDigits(text: string): boolean {
  return /\d/.test(text || "");
}
