import { supabase } from "@/integrations/supabase/client";
import { ExpOrder } from "./expeditionTypes";

export interface HydratedCustomer {
  cpf: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  cep: string | null;
  address: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

const digits = (v?: string | null) => (v || "").replace(/\D/g, "");

/**
 * A venda (pos_sales) muitas vezes nasce sem CPF/e-mail (PIX avulso, link, live),
 * mas o cadastro vivo em `pos_customers` já tem esses dados.
 * Esta função busca a ficha do cliente (por customer_id ou pelos 8 últimos dígitos
 * do telefone) e devolve os campos que faltam na venda — sem sobrescrever
 * o que já está preenchido no pedido.
 */
export async function fetchExpeditionCustomer(order: ExpOrder): Promise<HydratedCustomer | null> {
  const phone = digits(order.customer_phone || (order.payment_details as any)?.customer_phone);
  const suffix = phone.slice(-8);
  try {
    let row: any = null;
    if (order.customer_id) {
      const { data } = await supabase
        .from("pos_customers")
        .select("name, email, cpf, whatsapp, cep, address, address_number, complement, neighborhood, city, state")
        .eq("id", order.customer_id)
        .maybeSingle();
      row = data;
    }
    if (!row && suffix.length === 8) {
      const { data } = await supabase
        .from("pos_customers")
        .select("name, email, cpf, whatsapp, cep, address, address_number, complement, neighborhood, city, state")
        .like("whatsapp", `%${suffix}`)
        .limit(1);
      row = (data || [])[0] || null;
    }
    if (!row) return null;
    return {
      cpf: row.cpf || null,
      email: row.email || null,
      name: row.name || null,
      phone: row.whatsapp || null,
      cep: row.cep || null,
      address: row.address || null,
      number: row.address_number || null,
      complement: row.complement || null,
      neighborhood: row.neighborhood || null,
      city: row.city || null,
      state: row.state || null,
    };
  } catch {
    return null;
  }
}

/**
 * Persiste em `pos_sales` apenas os campos de cliente que estão vazios na venda
 * e existem na ficha. Nunca sobrescreve dado já informado no pedido.
 * Devolve o CPF/e-mail efetivos para uso imediato (ex.: emissão de NF-e).
 */
export async function hydrateSaleCustomer(
  order: ExpOrder,
  saleIds?: string[],
): Promise<{ cpf: string | null; email: string | null }> {
  const currentCpf = digits(order.customer_cpf || (order.payment_details as any)?.customer_cpf);
  const currentEmail = order.customer_email || (order.payment_details as any)?.customer_email || null;
  if (currentCpf.length === 11 && currentEmail) return { cpf: currentCpf, email: currentEmail };

  const c = await fetchExpeditionCustomer(order);
  if (!c) return { cpf: currentCpf || null, email: currentEmail };

  const cpf = currentCpf.length === 11 ? currentCpf : digits(c.cpf) || null;
  const email = currentEmail || c.email || null;

  const updates: Record<string, any> = {};
  if (!currentCpf && cpf) updates.customer_cpf = cpf;
  if (!currentEmail && email) updates.customer_email = email;
  if (!order.customer_name && c.name) updates.customer_name = c.name;

  if (Object.keys(updates).length) {
    const ids = saleIds?.length ? saleIds : [order.id];
    try {
      await supabase.from("pos_sales").update(updates as any).in("id", ids);
    } catch {
      /* best-effort: não bloqueia a expedição */
    }
  }

  return { cpf, email };
}
