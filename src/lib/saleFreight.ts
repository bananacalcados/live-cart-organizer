import { supabase } from '@/integrations/supabase/client';
import { extractEdgeError } from '@/lib/edgeFunctionError';
export interface FreightPackage { peso_g: number; c: number; l: number; a: number; itens: number; origem: 'produtos' | 'padrao' }
export interface FreightOption { source: 'correios' | 'frenet'; carrier: string; service: string; service_code: string; price: number; delivery_days: number | null; note: string; shipping_carrier: string; shipping_type: string }
export interface SaleFreightQuote { id: string; sale_id?: string; quoted_at: string; package: FreightPackage; options: FreightOption[]; errors: Record<string,string>; selected_option?: FreightOption | null }
export async function freightCall<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(await extractEdgeError(error, 'Não foi possível consultar os fretes'));
  if (data?.error && !data?.options && !data?.expiraEm) throw new Error(data.error);
  return data as T;
}
export function freightDate(value: string) { return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit' }); }