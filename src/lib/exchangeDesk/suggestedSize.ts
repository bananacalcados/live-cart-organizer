const normalize = (value: string | null | undefined) => (value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Sugestão para a equipe; nunca escolhe nem reserva uma numeração automaticamente. */
export function suggestExchangeSize(size: string | null | undefined, reason: string | null | undefined, verbatim: string | null | undefined): string | null {
  const original = (size || "").trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(original)) return null;
  const text = normalize(`${reason || ""} ${verbatim || ""}`);
  const direction = /\b(apertad|pequen|curto|justo)/.test(text) ? 1
    : /\b(grande|folgad|largo|sobrando)/.test(text) ? -1 : 0;
  if (!direction) return null;
  const value = Number(original.replace(",", ".")) + direction;
  return Number.isFinite(value) && value > 0 ? String(value) : null;
}
