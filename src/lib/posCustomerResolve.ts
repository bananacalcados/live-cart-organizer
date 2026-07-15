/**
 * Busca e resolução unificada de clientes para o PDV.
 *
 * Fonte de leitura: `customers_unified` (base completa que agrega Marketing,
 * PDV, checkout e campanhas — ~87k clientes). Isso garante que o PDV encontre
 * QUALQUER cliente, independente da loja ou método de cadastro.
 *
 * `pos_customers` continua sendo a tabela transacional (FK das vendas). Quando
 * um cliente vindo do unificado é selecionado para uma venda, ele é
 * materializado em `pos_customers` por CPF/telefone (sem duplicar).
 */
import { supabase } from '@/integrations/supabase/client';

export interface UnifiedSearchResult {
  id: string; // id do customers_unified
  name: string | null;
  whatsapp: string | null; // mapeado de phone_e164
  cpf: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  cep?: string | null;
  address?: string | null;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  total_orders?: number | null;
  total_spent?: number | null;
  avg_ticket?: number | null;
  last_purchase_at?: string | null;
  _fromUnified: true;
}

export function digitsOnly(v?: string | null): string {
  return (v || '').replace(/\D/g, '');
}

/**
 * Busca clientes na base unificada por CPF, telefone, nome ou email.
 */
export async function searchUnifiedCustomers(
  term: string,
  limit = 25,
): Promise<UnifiedSearchResult[]> {
  const q = (term || '').trim();
  if (q.length < 3) return [];
  const digits = digitsOnly(q);

  let builder = supabase
    .from('customers_unified')
    .select(
      'id, name, cpf, email, phone_e164, phone_suffix8, city, state, cep, address, address_number, complement, neighborhood, total_orders, total_spent, avg_ticket, last_purchase_at',
    )
    .is('merged_into_id', null)
    .order('last_purchase_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (digits.length === 11) {
    builder = builder.eq('cpf', digits);
  } else if (digits.length >= 8) {
    builder = builder.eq('phone_suffix8', digits.slice(-8));
  } else {
    builder = builder.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await builder;
  if (error) {
    console.error('[searchUnifiedCustomers]', error);
    return [];
  }
  return (data || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    whatsapp: c.phone_e164,
    cpf: c.cpf,
    email: c.email,
    city: c.city,
    state: c.state,
    cep: c.cep,
    address: c.address,
    address_number: c.address_number,
    complement: c.complement,
    neighborhood: c.neighborhood,
    total_orders: c.total_orders,
    total_spent: c.total_spent,
    avg_ticket: c.avg_ticket,
    last_purchase_at: c.last_purchase_at,
    _fromUnified: true as const,
  }));
}

/**
 * Encontra (sem criar) um pos_customers correspondente por CPF ou telefone.
 */
export async function findPosCustomer(record: {
  cpf?: string | null;
  whatsapp?: string | null;
}): Promise<any | null> {
  const cpf = digitsOnly(record.cpf);
  if (cpf.length === 11) {
    const { data } = await supabase
      .from('pos_customers')
      .select('*')
      .eq('cpf', cpf)
      .maybeSingle();
    if (data) return data;
  }
  const phone = digitsOnly(record.whatsapp);
  if (phone.length >= 10) {
    const last10 = phone.slice(-10);
    const { data } = await supabase
      .from('pos_customers')
      .select('*')
      .ilike('whatsapp', `%${last10}%`)
      .limit(2);
    if (data && data.length === 1) return data[0];
  }
  return null;
}

/**
 * Garante um pos_customers para o registro informado: retorna o existente
 * (por CPF/telefone) ou cria um novo. Use ao iniciar uma venda.
 */
export async function materializePosCustomer(record: {
  name?: string | null;
  cpf?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  cep?: string | null;
  address?: string | null;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
}): Promise<any | null> {
  const existing = await findPosCustomer(record);
  if (existing) return existing;
  const cpf = digitsOnly(record.cpf);
  const { data, error } = await supabase
    .from('pos_customers')
    .insert({
      name: record.name || 'Cliente',
      cpf: cpf.length === 11 ? cpf : null,
      email: record.email || null,
      whatsapp: record.whatsapp || null,
      cep: record.cep || null,
      address: record.address || null,
      address_number: record.address_number || null,
      complement: record.complement || null,
      neighborhood: record.neighborhood || null,
      city: record.city || null,
      state: record.state || null,
    } as any)
    .select()
    .single();
  if (error) {
    console.error('[materializePosCustomer]', error);
    return null;
  }
  return data;
}
