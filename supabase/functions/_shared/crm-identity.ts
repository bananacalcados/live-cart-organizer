/**
 * Etapa 5 — Enriquecimento por CRM (identidade multi-chave).
 *
 * Resolve QUEM é a pessoa em `customers_unified` a partir de qualquer sinal
 * disponível na conversão (telefone, CPF, e-mail ou @ do Instagram) e devolve:
 *   - todos os telefones conhecidos dela (atual + `previous_phones`)
 *   - PII adicional para o `user_data` da Meta (nome, e-mail, cidade, UF, CEP,
 *     data de nascimento, gênero, external_id)
 *
 * Com isso a memória de atribuição deixa de casar por "telefone igual" e passa
 * a casar por "mesma pessoa": a lead que entrou pelo typebot com um número e
 * comprou informando outro ainda recebe o `fbc` do clique original.
 *
 * Nada aqui pode lançar — atribuição/enriquecimento nunca quebra a conversão.
 */

import { normalizeMetaPhone } from "./meta-phone.ts";
import type { StoredAttribution } from "./meta-attribution-memory.ts";

export interface CrmIdentity {
  customer_id: string | null;
  customer_code: string | null;
  name: string | null;
  email: string | null;
  cpf: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
  birth_date: string | null;
  gender: string | null;
  instagram_handle: string | null;
  /** Telefones normalizados (E.164 sem "+"), sem duplicatas. */
  phones: string[];
  /** Qual chave resolveu o cliente: cpf | phone | email | instagram | null. */
  matched_by: string | null;
}

export interface IdentitySeed {
  phone?: string | null;
  email?: string | null;
  cpf?: string | null;
  instagram?: string | null;
}

const SELECT_COLS =
  "id, customer_code, name, email, cpf, city, state, cep, birth_date, gender, instagram_handle, phone_e164, previous_phones";

function normCpf(raw?: string | null): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

function normEmail(raw?: string | null): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return v && v.includes("@") ? v : null;
}

function normIg(raw?: string | null): string | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/^@/, "");
  return v || null;
}

function uniquePhones(...values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const n = normalizeMetaPhone(v);
    if (n && n.length >= 12 && !out.includes(n)) out.push(n);
  }
  return out;
}

function toIdentity(row: Record<string, unknown>, matchedBy: string, seedPhone?: string | null): CrmIdentity {
  const prev = Array.isArray(row.previous_phones) ? (row.previous_phones as string[]) : [];
  return {
    customer_id: (row.id as string) ?? null,
    customer_code: (row.customer_code as string) ?? null,
    name: (row.name as string) ?? null,
    email: (row.email as string) ?? null,
    cpf: (row.cpf as string) ?? null,
    city: (row.city as string) ?? null,
    state: (row.state as string) ?? null,
    cep: (row.cep as string) ?? null,
    birth_date: (row.birth_date as string) ?? null,
    gender: (row.gender as string) ?? null,
    instagram_handle: (row.instagram_handle as string) ?? null,
    phones: uniquePhones(seedPhone, row.phone_e164 as string, ...prev),
    matched_by: matchedBy,
  };
}

/**
 * Resolve a pessoa em `customers_unified`. Ordem de força da identidade:
 * CPF > telefone > e-mail > Instagram (mesma hierarquia usada no CRM).
 * Retorna `null` quando nenhuma chave casa (o chamador segue com o que tem).
 */
export async function resolveCrmIdentity(
  supabase: any,
  seed: IdentitySeed,
): Promise<CrmIdentity | null> {
  try {
    const phone = normalizeMetaPhone(seed.phone);
    const suffix = phone && phone.length >= 12 ? phone.slice(-8) : null;
    const cpf = normCpf(seed.cpf);
    const email = normEmail(seed.email);
    const ig = normIg(seed.instagram);

    const attempts: { by: string; run: () => Promise<{ data: any }> }[] = [];

    if (cpf) {
      attempts.push({
        by: "cpf",
        run: () =>
          supabase.from("customers_unified").select(SELECT_COLS).is("merged_into_id", null)
            .eq("cpf", cpf).limit(1).maybeSingle(),
      });
    }
    if (suffix) {
      attempts.push({
        by: "phone",
        run: () =>
          supabase.from("customers_unified").select(SELECT_COLS).is("merged_into_id", null)
            .eq("phone_suffix8", suffix).limit(1).maybeSingle(),
      });
    }
    if (email) {
      attempts.push({
        by: "email",
        run: () =>
          supabase.from("customers_unified").select(SELECT_COLS).is("merged_into_id", null)
            .ilike("email", email).limit(1).maybeSingle(),
      });
    }
    if (ig) {
      attempts.push({
        by: "instagram",
        run: () =>
          supabase.from("customers_unified").select(SELECT_COLS).is("merged_into_id", null)
            .ilike("instagram_handle", ig).limit(1).maybeSingle(),
      });
    }

    for (const a of attempts) {
      const { data } = await a.run();
      if (data) return toIdentity(data, a.by, seed.phone);
    }

    // Sem cliente no CRM: ainda devolve o telefone do seed para o lookup de atribuição
    const phones = uniquePhones(seed.phone);
    if (phones.length === 0) return null;
    return {
      customer_id: null, customer_code: null, name: null, email: null, cpf: null,
      city: null, state: null, cep: null, birth_date: null, gender: null,
      instagram_handle: null, phones, matched_by: null,
    };
  } catch (e) {
    console.warn("[crm-identity] resolve failed:", e);
    return null;
  }
}

export interface MultiAttribution extends StoredAttribution {
  matched_phone: string;
}

/**
 * Busca a memória de atribuição em TODOS os telefones conhecidos da pessoa,
 * escolhendo o clique mais recente ainda dentro da janela de 90 dias.
 */
export async function getMetaAttributionForPhones(
  supabase: any,
  phones: string[],
): Promise<MultiAttribution | null> {
  try {
    const list = phones.filter((p) => p && p.length >= 12);
    if (list.length === 0) return null;
    const { data, error } = await supabase
      .from("meta_attribution_identities")
      .select("phone, fbc, fbp, ctwa_clid, origin, last_seen_at")
      .in("phone", list)
      .gt("expires_at", new Date().toISOString())
      .order("last_seen_at", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const row = data[0];
    return {
      matched_phone: row.phone as string,
      fbc: row.fbc ?? null,
      fbp: row.fbp ?? null,
      ctwa_clid: row.ctwa_clid ?? null,
      origin: row.origin ?? null,
      last_seen_at: row.last_seen_at ?? null,
    };
  } catch (e) {
    console.warn("[crm-identity] attribution multi-lookup failed:", e);
    return null;
  }
}

/** `db` da Meta: data de nascimento em YYYYMMDD. */
export function normalizeBirthDate(raw?: string | null): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}${br[2]}${br[1]}`;
  return null;
}

/** `ge` da Meta: "f" ou "m". */
export function normalizeGender(raw?: string | null): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith("f")) return "f";
  if (v.startsWith("m")) return "m";
  return null;
}
