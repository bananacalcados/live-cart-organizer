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

  if (existingCustomerId) {
    const updated = await updateById(existingCustomerId);
    if (updated) return updated;
  }

  const matchedCustomerId = await findExistingCustomerId(payload);
  if (matchedCustomerId) {
    const updated = await updateById(matchedCustomerId);
    if (updated) return updated;
  }

  const { data, error } = await supabase
    .from("pos_customers")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
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
