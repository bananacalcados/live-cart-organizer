/**
 * Espelho do parse_tracking_input do banco: ao colar um link de rastreio
 * (Frenet, Correios, J&T, Jadlog, Loggi) devolve só o código + transportadora.
 * O banco normaliza de novo ao salvar, então isto é só para a tela já mostrar o código.
 */
const PREFIX: Record<string, string> = { COR: "Correios", JTE: "J&T Express", JNT: "J&T Express", JAD: "Jadlog", LOG: "Loggi", AZU: "Azul Cargo", BUS: "Buslog" };

export function parseTrackingInput(input: string): { code: string; carrier: string | null; url: string | null } | null {
  const t = (input || "").trim();
  if (!t || !t.includes("/")) return null;
  if (/bananacalcados/i.test(t)) return null;
  const url = /^https?:\/\//i.test(t) ? t : null;
  let m = t.match(/(?:^|\/)(COR|JTE|JAD|LOG|JNT|TNT|AZU|BUS)\/([A-Za-z0-9]+)/i);
  if (m) return { code: m[2].toUpperCase(), carrier: PREFIX[m[1].toUpperCase()] ?? null, url };
  m = t.match(/([A-Za-z]{2}[0-9]{9}BR)/i);
  if (m) return { code: m[1].toUpperCase(), carrier: "Correios", url };
  if (/jtexpress|jet\.com/i.test(t)) { m = t.match(/([0-9]{12,16})/); if (m) return { code: m[1], carrier: "J&T Express", url }; }
  if (/jadlog/i.test(t)) { m = t.match(/(?:cte|codigo|pedido|tracking)=?([0-9]{8,16})/i) || t.match(/([0-9]{8,16})/); if (m) return { code: m[1], carrier: "Jadlog", url }; }
  m = t.match(/^\/([0-9]{8,16})\/?$/);
  if (m) return { code: m[1], carrier: null, url };
  return null;
}

/** Valor que o campo de rastreio deve mostrar/salvar. */
export function normalizeTrackingField(input: string): string {
  return parseTrackingInput(input)?.code ?? input;
}
