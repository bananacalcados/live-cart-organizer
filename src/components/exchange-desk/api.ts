import { supabase } from "@/integrations/supabase/client";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;

export async function deskCall<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message || "Falha ao falar com o servidor");
  return data as T;
}

export const deskAction = (p_id: string, p_action: string, extra: { p_reason?: string; p_note?: string; p_assignee?: string; p_code?: string; p_troca_id?: string } = {}) =>
  deskCall("exchange_desk_action", { p_id, p_action, ...extra });

export interface DeskTemplate { key: string; title: string; body: string }
export async function loadTemplates(): Promise<Record<string, DeskTemplate>> {
  const { data } = await (supabase as any).from("exchange_message_templates").select("key,title,body").limit(50);
  return Object.fromEntries(((data || []) as DeskTemplate[]).map((t) => [t.key, t]));
}
