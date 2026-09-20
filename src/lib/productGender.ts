// Valores canônicos de gênero de produto (mesmo vocabulário do banco).
export const GENDER_VALUES = [
  "Feminino",
  "Masculino",
  "Unissex",
  "Menino",
  "Menina",
  "Infantil",
] as const;

export type ProductGender = (typeof GENDER_VALUES)[number];

/** Normaliza qualquer grafia antiga ("feminino", "INFANTIL") para o valor canônico. */
export function normalizeGender(g: string | null | undefined): ProductGender | null {
  if (!g) return null;
  const k = g.trim().toLowerCase();
  const found = GENDER_VALUES.find((v) => v.toLowerCase() === k);
  return found ?? null;
}
