const COMMON_LOOKALIKES = new Set([
  "vara", "vaca", "vago", "viga", "vala", "vaza", "vasa", "voga",
]);

function collapseRepeated(value: string): string {
  return value.replace(/([a-z])\1+/g, "$1");
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length === b.length) {
      i++;
      j++;
    } else if (a.length > b.length) {
      i++;
    } else {
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function normalizeRhVagaText(text: string): string[] {
  const plain = String(text || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\bv a g a s\b/g, "vagas")
    .replace(/\bv a g a\b/g, "vaga");
  return plain ? plain.split(/\s+/).map(collapseRepeated) : [];
}

/** Exclusivo da regra RH; as keywords antigas continuam usando substring simples. */
export function matchesRhVaga(text: string): boolean {
  return normalizeRhVagaText(text).some((word) => {
    if (COMMON_LOOKALIKES.has(word)) return false;
    if (word === "vaga" || word === "vagas") return true;
    if (word.length < 3 || word.length > 5) return false;
    return editDistanceAtMostOne(word, "vaga") || editDistanceAtMostOne(word, "vagas");
  });
}
