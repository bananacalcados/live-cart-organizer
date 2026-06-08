/**
 * Edição unificada de clientes a partir do PDV > Clientes.
 *
 * A lista do PDV lê de `customers_unified`, mas os dados oficiais vivem em
 * múltiplas tabelas. Ao editar um cliente, propagamos as mudanças para:
 *   1. `customers_unified` (fonte da lista / busca)
 *   2. `pos_customers`     (tabela transacional das vendas)
 *   3. `zoppy_customers`   (CRM / Marketing)
 *
 * Casamento entre as tabelas: por CPF (11 dígitos) e, na ausência, pelos
 * últimos 8 dígitos do telefone. Quando o telefone muda, o número antigo é
 * preservado no histórico (`previous_phones` / `previous_whatsapp_numbers`).
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeBRPhone } from "@/lib/phoneUtils";

export interface CustomerEditValues {
  name: string;
  cpf: string;
  email: string;
  whatsapp: string;
  birth_date: string; // yyyy-mm-dd or ""
  gender: string;
  age_range: string;
  shoe_size: string;
  preferred_style: string;
  cep: string;
  address: string;
  address_number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

const txt = (v: string) => {
  const t = (v || "").trim();
  return t ? t : null;
};
const digits = (v: string) => {
  const d = (v || "").replace(/\D/g, "");
  return d ? d : null;
};

export interface PropagationResult {
  unified: boolean;
  pos: number;
  zoppy: number;
}

/**
 * Propaga a edição do cliente para customers_unified, pos_customers e zoppy_customers.
 * @param unifiedId id do registro em customers_unified (linha da lista)
 */
export async function propagateCustomerEdit(
  unifiedId: string,
  form: CustomerEditValues,
): Promise<PropagationResult> {
  const cpf = digits(form.cpf);
  const phoneE164 = form.whatsapp.trim() ? normalizeBRPhone(form.whatsapp) : null;
  const suffix8 = phoneE164 ? phoneE164.slice(-8) : null;
  const result: PropagationResult = { unified: false, pos: 0, zoppy: 0 };

  // ---- 1) customers_unified (por id) ----
  {
    const { data: current } = await supabase
      .from("customers_unified")
      .select("phone_e164, previous_phones")
      .eq("id", unifiedId)
      .maybeSingle();

    const previous_phones: string[] = ((current as any)?.previous_phones || []).filter(Boolean);
    if (
      phoneE164 &&
      (current as any)?.phone_e164 &&
      (current as any).phone_e164 !== phoneE164 &&
      !previous_phones.includes((current as any).phone_e164)
    ) {
      previous_phones.push((current as any).phone_e164);
    }

    const update: Record<string, any> = {
      name: txt(form.name),
      cpf,
      email: txt(form.email),
      gender: txt(form.gender),
      age_range: txt(form.age_range),
      shoe_size: txt(form.shoe_size),
      preferred_style: txt(form.preferred_style),
      cep: digits(form.cep),
      address: txt(form.address),
      address_number: txt(form.address_number),
      complement: txt(form.complement),
      neighborhood: txt(form.neighborhood),
      city: txt(form.city),
      state: txt(form.state)?.toUpperCase() ?? null,
      birth_date: form.birth_date || null,
    };
    if (phoneE164) {
      update.phone_e164 = phoneE164;
      update.phone_suffix8 = suffix8;
      update.previous_phones = previous_phones;
    }

    const { error } = await supabase.from("customers_unified").update(update).eq("id", unifiedId);
    if (error) throw error;
    result.unified = true;
  }

  // ---- 2) pos_customers (por cpf, depois por suffix8) ----
  {
    const posUpdate: Record<string, any> = {
      name: txt(form.name),
      cpf,
      email: txt(form.email),
      gender: txt(form.gender),
      age_range: txt(form.age_range),
      shoe_size: txt(form.shoe_size),
      preferred_style: txt(form.preferred_style),
      cep: digits(form.cep),
      address: txt(form.address),
      address_number: txt(form.address_number),
      complement: txt(form.complement),
      neighborhood: txt(form.neighborhood),
      city: txt(form.city),
      state: txt(form.state)?.toUpperCase() ?? null,
    };

    const matched = await findMatches("pos_customers", "whatsapp", cpf, suffix8);
    for (const row of matched) {
      const u = { ...posUpdate };
      if (phoneE164) {
        const prev: string[] = ((row as any).previous_whatsapp_numbers || []).filter(Boolean);
        if (row.whatsapp && row.whatsapp !== phoneE164 && !prev.includes(row.whatsapp)) {
          prev.push(row.whatsapp);
        }
        u.whatsapp = phoneE164;
        u.previous_whatsapp_numbers = prev;
      }
      const { error } = await supabase.from("pos_customers").update(u).eq("id", row.id);
      if (!error) result.pos++;
    }
  }

  // ---- 3) zoppy_customers (CRM / Marketing) ----
  {
    const fullName = (form.name || "").trim();
    const parts = fullName.split(/\s+/);
    const first_name = parts.shift() || null;
    const last_name = parts.length ? parts.join(" ") : null;

    const zUpdate: Record<string, any> = {
      first_name,
      last_name,
      cpf,
      email: txt(form.email),
      gender: txt(form.gender),
      city: txt(form.city),
      state: txt(form.state)?.toUpperCase() ?? null,
      postcode: digits(form.cep),
      address1: txt(form.address),
      shoe_size: txt(form.shoe_size),
      preferred_style: txt(form.preferred_style),
      age_range: txt(form.age_range),
    };
    if (phoneE164) zUpdate.phone = phoneE164;
    if (form.birth_date) zUpdate.birth_date = form.birth_date;

    const matched = await findMatches("zoppy_customers", "phone", cpf, suffix8);
    for (const row of matched) {
      const { error } = await supabase.from("zoppy_customers").update(zUpdate).eq("id", row.id);
      if (!error) result.zoppy++;
    }
  }

  return result;
}

/** Encontra registros em uma tabela por CPF e/ou últimos 8 dígitos do telefone. */
async function findMatches(
  table: "pos_customers" | "zoppy_customers",
  phoneCol: "whatsapp" | "phone",
  cpf: string | null,
  suffix8: string | null,
): Promise<any[]> {
  const found = new Map<string, any>();
  const selectCols = table === "pos_customers"
    ? "id, whatsapp, previous_whatsapp_numbers"
    : "id, phone";

  if (cpf) {
    const { data } = await supabase.from(table).select(selectCols).eq("cpf", cpf).limit(20);
    (data || []).forEach((r: any) => found.set(r.id, r));
  }
  if (suffix8) {
    const { data } = await supabase
      .from(table)
      .select(selectCols)
      .ilike(phoneCol, `%${suffix8}`)
      .limit(20);
    (data || []).forEach((r: any) => found.set(r.id, r));
  }
  return Array.from(found.values());
}
