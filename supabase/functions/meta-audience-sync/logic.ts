// Regras puras da sincronização de públicos (testáveis).
export const SCHEMA = ["PHONE", "EMAIL", "FN", "LN", "CT", "ST", "ZIP", "COUNTRY"];
export const REMOVE_LIMIT = 0.2; // rodada não remove mais de 20% do público
export const REPLACE_MIN = 0.7; // 1ª carga precisa de pelo menos 70% do tamanho na Meta

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export async function buildAudienceRow(c: any, normPhone: (p: string) => string) {
  const parts = strip(String(c.full_name || "").trim().toLowerCase()).split(/\s+/).filter(Boolean);
  const raw = [
    c.phone ? normPhone(c.phone) : "",
    String(c.email || "").trim().toLowerCase(),
    parts[0] || "",
    parts.length > 1 ? parts[parts.length - 1] : "",
    strip(String(c.city || "").toLowerCase()).replace(/[^a-z0-9]/g, ""),
    strip(String(c.state || "").trim().toLowerCase()).replace(/[^a-z]/g, "").slice(0, 2),
    String(c.zip || "").replace(/[^0-9]/g, "").slice(0, 5),
    c.phone || c.email ? "br" : "",
  ];
  if (!raw[0] && !raw[1]) raw.fill("");
  const hashes = await Promise.all(raw.map((v) => (v ? sha256(v) : Promise.resolve(""))));
  return { key: c.key as string, hashes, row_hash: await sha256(hashes.join("|")) };
}

export function planDiff(candidates: { key: string; row_hash: string }[], members: { key: string; row_hash: string }[]) {
  const mem = new Map(members.map((m) => [m.key, m]));
  const cand = new Set(candidates.map((c) => c.key));
  const add = candidates.filter((c) => mem.get(c.key)?.row_hash !== c.row_hash);
  const remove = members.filter((m) => !cand.has(m.key));
  return { add, remove };
}

export function checkGuards(p: { replace: boolean; erpCount: number; metaLower: number | null; activeMembers: number; removing: number; force: boolean }) {
  if (p.erpCount === 0) return { ok: false, reason: "Regra devolveu zero pessoas — nada foi alterado" };
  if (p.replace) {
    if (p.metaLower !== null && p.metaLower > 0 && p.erpCount < p.metaLower * REPLACE_MIN)
      return { ok: false, reason: `1ª carga bloqueada: ERP ${p.erpCount} < 70% da lista atual na Meta (${p.metaLower})` };
    return { ok: true };
  }
  if (!p.force && p.activeMembers >= 50 && p.removing > p.activeMembers * REMOVE_LIMIT)
    return { ok: false, reason: `Rodada bloqueada: removeria ${p.removing} de ${p.activeMembers} (>20%)` };
  return { ok: true };
}
