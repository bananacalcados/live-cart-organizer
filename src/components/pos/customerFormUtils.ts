import { supabase } from "@/integrations/supabase/client";

export type POSCustomerFormValues = {
  name: string;
  email: string;
  whatsapp: string;
  cpf: string;
  cep: string;
  address: string;
  address_number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  age_range: string;
  preferred_style: string;
  notes: string;
  shoe_size: string;
  gender: string;
  has_children: boolean;
  children_age_range: string;
};

const nullableText = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const digitsOnlyOrNull = (value: string) => {
  const digits = value.replace(/\D/g, "").trim();
  return digits ? digits : null;
};

export const buildPosCustomerPayload = (form: POSCustomerFormValues) => ({
  name: form.name.trim(),
  email: nullableText(form.email),
  whatsapp: digitsOnlyOrNull(form.whatsapp),
  cpf: digitsOnlyOrNull(form.cpf),
  cep: digitsOnlyOrNull(form.cep),
  address: nullableText(form.address),
  address_number: nullableText(form.address_number),
  complement: nullableText(form.complement),
  neighborhood: nullableText(form.neighborhood),
  city: nullableText(form.city),
  state: nullableText(form.state)?.toUpperCase(),
  age_range: nullableText(form.age_range),
  preferred_style: nullableText(form.preferred_style),
  notes: nullableText(form.notes),
  shoe_size: nullableText(form.shoe_size),
  gender: nullableText(form.gender),
  has_children: form.has_children,
  children_age_range: form.has_children ? nullableText(form.children_age_range) : null,
});

const findExistingCustomerId = async (payload: ReturnType<typeof buildPosCustomerPayload>) => {
  if (payload.cpf) {
    const { data, error } = await supabase
      .from("pos_customers")
      .select("id")
      .eq("cpf", payload.cpf)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) return data.id;
  }

  if (payload.whatsapp) {
    const { data, error } = await supabase
      .from("pos_customers")
      .select("id")
      .eq("whatsapp", payload.whatsapp)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) return data.id;
  }

  if (payload.email) {
    const { data, error } = await supabase
      .from("pos_customers")
      .select("id")
      .eq("email", payload.email)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) return data.id;
  }

  return null;
};

export const savePosCustomer = async (
  existingCustomerId: string | null | undefined,
  form: POSCustomerFormValues,
) => {
  const payload = buildPosCustomerPayload(form);

  const updateById = async (id: string) => {
    // Check if whatsapp changed — if so, preserve old number
    if (payload.whatsapp) {
      const { data: current } = await supabase
        .from("pos_customers")
        .select("whatsapp, previous_whatsapp_numbers")
        .eq("id", id)
        .maybeSingle();

      if (current?.whatsapp && current.whatsapp !== payload.whatsapp) {
        const prev: string[] = (current as any).previous_whatsapp_numbers || [];
        if (!prev.includes(current.whatsapp)) {
          (payload as any).previous_whatsapp_numbers = [...prev, current.whatsapp];
        }
      }
    }

    const { data, error } = await supabase
      .from("pos_customers")
      .update(payload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw error;
    return data;
  };

  // CASO 1: edição explícita de cliente existente — atualiza somente esse ID, sem fallback
  if (existingCustomerId) {
    const updated = await updateById(existingCustomerId);
    if (updated) return updated;
    // Se o ID veio mas não existe mais, NÃO faz fallback de match para evitar sequestro
    throw new Error("Cliente não encontrado para atualização");
  }

  // CASO 2: cadastro novo — só faz match se TIVER pelo menos um identificador forte (cpf, whatsapp ou email)
  // E o nome no payload bate (mesmas iniciais) com o cliente encontrado, evitando sobrescrever cadastros alheios
  const hasStrongIdentifier = !!(payload.cpf || payload.whatsapp || payload.email);
  if (hasStrongIdentifier) {
    const matchedCustomerId = await findExistingCustomerId(payload);
    if (matchedCustomerId) {
      // Trava de segurança: confere se o nome do match é compatível com o nome digitado
      const { data: matchedCustomer } = await supabase
        .from("pos_customers")
        .select("id, name")
        .eq("id", matchedCustomerId)
        .maybeSingle();

      const normalizeName = (n: string | null | undefined) =>
        (n || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

      const newName = normalizeName(payload.name);
      const existingName = normalizeName(matchedCustomer?.name);

      // Aceita match se: nomes idênticos OU primeiro nome igual OU um contém o outro
      const firstNameNew = newName.split(" ")[0];
      const firstNameOld = existingName.split(" ")[0];
      const namesCompatible =
        !existingName ||
        newName === existingName ||
        firstNameNew === firstNameOld ||
        existingName.includes(newName) ||
        newName.includes(existingName);

      if (namesCompatible) {
        const updated = await updateById(matchedCustomerId);
        if (updated) return updated;
      } else {
        // Nome incompatível — não sobrescreve cadastro alheio. Cria novo.
        console.warn(
          `[savePosCustomer] Bloqueado sequestro: nome novo "${payload.name}" não bate com cadastro existente "${matchedCustomer?.name}" (id: ${matchedCustomerId}). Criando novo cliente.`,
        );
      }
    }
  }

  const { data, error } = await supabase
    .from("pos_customers")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  // Best-effort: propagate to CRM (zoppy_customers)
  syncToZoppyCustomer(payload).catch((e) => console.warn("[savePosCustomer] zoppy sync skipped:", e?.message));

  return data;
};

/**
 * Sync a PDV customer record back to the CRM (zoppy_customers).
 * Matches by CPF first, then by last 8 phone digits. Only updates when found.
 */
const syncToZoppyCustomer = async (payload: ReturnType<typeof buildPosCustomerPayload>) => {
  let zoppyId: string | null = null;

  if (payload.cpf) {
    const { data } = await supabase
      .from("zoppy_customers")
      .select("id")
      .eq("cpf", payload.cpf)
      .maybeSingle();
    zoppyId = data?.id || null;
  }

  if (!zoppyId && payload.whatsapp) {
    const last8 = payload.whatsapp.slice(-8);
    if (last8.length === 8) {
      const { data } = await supabase
        .from("zoppy_customers")
        .select("id")
        .ilike("phone", `%${last8}`)
        .limit(2);
      if (data && data.length === 1) zoppyId = data[0].id;
    }
  }

  if (!zoppyId) return;

  const fullName = (payload.name || "").trim();
  const parts = fullName.split(/\s+/);
  const first_name = parts.shift() || "";
  const last_name = parts.join(" ") || null;

  const update: Record<string, any> = {};
  if (first_name) update.first_name = first_name;
  if (last_name !== undefined) update.last_name = last_name;
  if (payload.cpf) update.cpf = payload.cpf;
  if (payload.email) update.email = payload.email;
  if (payload.whatsapp) update.phone = payload.whatsapp;
  if (payload.city) update.city = payload.city;
  if (payload.state) update.state = payload.state;
  if (payload.shoe_size) update.shoe_size = payload.shoe_size;
  if (payload.preferred_style) update.preferred_style = payload.preferred_style;
  if (payload.age_range) update.age_range = payload.age_range;

  if (Object.keys(update).length === 0) return;

  await supabase.from("zoppy_customers").update(update).eq("id", zoppyId);
};

/** Remove a previous whatsapp number from the history */
export const removePreviousWhatsApp = async (customerId: string, phoneToRemove: string) => {
  const { data: current } = await supabase
    .from("pos_customers")
    .select("previous_whatsapp_numbers")
    .eq("id", customerId)
    .maybeSingle();

  if (!current) return;
  const prev: string[] = (current as any).previous_whatsapp_numbers || [];
  const updated = prev.filter(p => p !== phoneToRemove);

  const { error } = await supabase
    .from("pos_customers")
    .update({ previous_whatsapp_numbers: updated } as any)
    .eq("id", customerId);

  if (error) throw error;
};
