import { supabase } from '@/integrations/supabase/client';

export type CentralType = 'troca' | 'devolucao';
export interface CentralItem { id: string; name: string; size: string | null; quantity: number; open?: boolean }
export interface CentralOption { id: string; name: string; size: string | null; color: string | null; image_url: string | null; in_stock: boolean; same_product: boolean }
export interface CentralSimulation {
  dry_run: boolean;
  status: 'running' | 'success' | 'failed';
  code?: string;
  valid_until?: string;
  error?: string;
  correios?: { ok: boolean; service_code?: string; return_items?: { nome?: string; quantidade?: number; valor_pago?: number }[] };
  nfe?: {
    precheck_ok: boolean; valor_novo?: number; valor_bruto?: number; desconto_rateado?: number;
    destinatario?: { fonte?: string; nome?: string; Municipio?: string; Uf?: string; cfop?: string };
  };
  whatsapp_message?: string;
  whatsapp_sent?: boolean;
  outbox?: string;
}
export interface CentralResult {
  status?: string; reason?: string; existing?: boolean;
  reverse_code?: string; reverse_valid_until?: string; simulation?: CentralSimulation;
}
export interface CentralContext {
  first_name: string; type: CentralType; items: CentralItem[]; delivered_at: string | null; deadline_at: string | null;
  eligibility: string; used: boolean; require_product_choice?: boolean; is_test?: boolean; test_simulation?: CentralSimulation | null;
  progress: { id: string; item_id: string | null; item_name?: string | null; item_size?: string | null; status: string; type: string; reason: string | null; reverse_code?: string | null; reverse_valid_until?: string | null }[];
}

export async function centralCall<T>(name: 'central-resolve' | 'central-submit', body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error || data?.error) {
    let message = data?.error;
    if (!message && error?.context instanceof Response) {
      try { message = (await error.context.json()).error; } catch { /* generic below */ }
    }
    throw new Error(message || 'Não foi possível continuar. Peça ajuda à equipe.');
  }
  return data as T;
}
