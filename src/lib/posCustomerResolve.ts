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
import { buildPhoneVariations } from '@/lib/phoneUtils';

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

export interface PosCustomerSearchRow {
  id: string;
  name: string | null;
  whatsapp: string | null;
  cpf: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  previous_whatsapp_numbers: string[] | null;
  _fromUnified?: true;
}

/**
 * Busca do Perfil 360: pos_customers (nome/email, CPF ou WhatsApp com variações
 * do 9º dígito) + customers_unified, deduplicado por CPF/últimos 8 dígitos.
 * Compartilhada com o "Novo estorno". Lança erro da consulta em pos_customers.
 */
export async function searchPosAndUnifiedCustomers(term: string): Promise<PosCustomerSearchRow[]> {
  const q = (term || '').trim();
  if (q.length < 3) return [];
  const digits = digitsOnly(q);
  const isPhone = digits.length >= 8;
  const isCpf = digits.length === 11;

  let queryBuilder = supabase
    .from('pos_customers')
    .select('id, name, whatsapp, cpf, email, city, state, previous_whatsapp_numbers')
    .limit(25);
  if (isCpf) {
    queryBuilder = queryBuilder.ilike('cpf', `%${digits}%`);
  } else if (isPhone) {
    const variations = buildPhoneVariations(q);
    const last8 = digits.slice(-8);
    queryBuilder = queryBuilder.or(
      variations.map((v) => `whatsapp.ilike.%${v}%`).join(',') + `,whatsapp.ilike.%${last8}%`,
    );
  } else {
    queryBuilder = queryBuilder.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const [{ data: posData, error }, unifiedData] = await Promise.all([
    queryBuilder,
    searchUnifiedCustomers(q, 25),
  ]);
  if (error) throw error;

  const merged: PosCustomerSearchRow[] = [...((posData as PosCustomerSearchRow[]) || [])];
  const seen = new Set(
    merged.map((c) => c.cpf?.replace(/\D/g, '') || c.whatsapp?.replace(/\D/g, '').slice(-8) || c.id),
  );
  for (const u of unifiedData) {
    const key = u.cpf?.replace(/\D/g, '') || u.whatsapp?.replace(/\D/g, '').slice(-8) || u.id;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id: u.id, name: u.name, whatsapp: u.whatsapp, cpf: u.cpf, email: u.email,
      city: u.city, state: u.state, previous_whatsapp_numbers: null, _fromUnified: true,
    });
  }
  return merged;
}

export interface KnownCustomerData {
  name: string | null; cpf: string | null; email: string | null; cep: string | null;
  address: string | null; address_number: string | null; complement: string | null;
  neighborhood: string | null; city: string | null; state: string | null;
}

/**
 * Junta os dados já conhecidos da cliente (pos_customers + customers_unified
 * pelo telefone) para pré-preencher links de checkout. Campo a campo, o
 * cadastro do PDV tem prioridade; o unificado só entra quando há UM único
 * cliente com aqueles 8 últimos dígitos (nunca chuta entre pessoas).
 */
export function mergeKnownCustomer(pos: any | null, unified: any | null): KnownCustomerData {
  const pick = (k: string) => (pos?.[k] || unified?.[k] || null) as string | null;
  return {
    name: pick('name'), cpf: pick('cpf'), email: pick('email'), cep: pick('cep'),
    address: pick('address'), address_number: pick('address_number'), complement: pick('complement'),
    neighborhood: pick('neighborhood'), city: pick('city'), state: pick('state'),
  };
}

export async function loadKnownCustomerByPhone(phone: string, posCustomer: any | null): Promise<KnownCustomerData> {
  const digits = digitsOnly(phone);
  let unified: any = null;
  if (digits.length >= 8) {
    const { data } = await supabase
      .from('customers_unified')
      .select('name, cpf, email, cep, address, address_number, complement, neighborhood, city, state')
      .is('merged_into_id', null)
      .eq('phone_suffix8', digits.slice(-8))
      .limit(2);
    if (data && data.length === 1) unified = data[0];
  }
  return mergeKnownCustomer(posCustomer, unified);
}

/**
 * Preenche APENAS campos vazios do formulário do checkout com os dados
 * conhecidos da cliente. Dados do pedido e o que já foi digitado têm
 * prioridade — nunca sobrescreve. Usado por links antigos, criados antes
 * do prefill automático na geração do link.
 */
export function fillEmptyCheckoutFields(
  prev: Record<string, string>,
  known: KnownCustomerData,
): Record<string, string> {
  const out: Record<string, string> = { ...prev };
  const fill = (key: string, value: string | null | undefined) => {
    if (!out[key] && value) out[key] = value;
  };
  fill('fullName', known.name);
  fill('email', known.email);
  fill('cpf', known.cpf);
  fill('cep', known.cep);
  fill('address', known.address);
  fill('addressNumber', known.address_number);
  fill('complement', known.complement);
  fill('neighborhood', known.neighborhood);
  fill('city', known.city);
  fill('state', known.state);
  return out;
}
