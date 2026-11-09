import { supabase } from '@/integrations/supabase/client';
export type CentralType = 'troca' | 'devolucao';
export interface CentralItem { id: string; name: string; size: string | null; quantity: number }
export interface CentralOption { id: string; name: string; size: string | null; color: string | null; image_url: string | null; in_stock: boolean; same_product: boolean }
export interface CentralContext { first_name: string; type: CentralType; items: CentralItem[]; delivered_at: string | null; deadline_at: string | null; eligibility: string; used: boolean; progress: { id: string; item_id: string | null; status: string; type: string; reason: string | null }[] }
export async function centralCall<T>(name: 'central-resolve' | 'central-submit', body: Record<string,unknown>): Promise<T> {
  const { data,error }=await supabase.functions.invoke(name,{ body });
  if (error || data?.error) {
    let message=data?.error;
    if (!message && error?.context instanceof Response) { try { message=(await error.context.json()).error; } catch { /* generic below */ } }
    throw new Error(message || 'Não foi possível continuar. Peça ajuda à equipe.');
  }
  return data as T;
}