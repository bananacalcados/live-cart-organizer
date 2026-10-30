import { supabase } from "@/integrations/supabase/client";

export type GroupAdminActionType =
  | "rename" | "set_description" | "set_photo"
  | "set_only_admins_send" | "set_only_admins_add"
  | "pin_message" | "promote_admin" | "demote_admin"
  | "add_participant" | "remove_participant";

export interface EnqueueGroupActionInput {
  whatsapp_number_id: string;
  fallback_number_id?: string | null;
  override_number_id?: string | null;
  group_db_id?: string | null;
  group_jid: string;
  group_name_snapshot?: string | null;
  campaign_id?: string | null;
  action_type: GroupAdminActionType;
  payload: Record<string, unknown>;
  batch?: string | null;
  requested_by?: string;
  notes?: string | null;
  seq?: number | null;
  not_before?: string | null;
}

/** Gap médio padrão do throttle (45–120s) usado para estimar a conclusão de um lote. */
export const AVG_GAP_SECONDS = 82;

export function estimateBatchMinutes(count: number, avgGapSeconds = AVG_GAP_SECONDS): number {
  return Math.max(1, Math.ceil((count * avgGapSeconds) / 60));
}

/** Gera um código de lote legível, ex.: 2026-10-17-203015-a1b2 */
export function newBatchCode(prefix = "lote"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Enfileira ações administrativas de grupo. Retorna quantas foram gravadas. */
export async function enqueueGroupAdminActions(items: EnqueueGroupActionInput[]): Promise<number> {
  if (items.length === 0) return 0;
  const rows = items.map((it, i) => ({
    whatsapp_number_id: it.whatsapp_number_id,
    fallback_number_id: it.fallback_number_id ?? it.whatsapp_number_id,
    override_number_id: it.override_number_id ?? null,
    group_db_id: it.group_db_id ?? null,
    group_jid: it.group_jid,
    group_name_snapshot: it.group_name_snapshot ?? null,
    campaign_id: it.campaign_id ?? null,
    action_type: it.action_type,
    payload: it.payload,
    batch: it.batch ?? null,
    requested_by: it.requested_by ?? "user",
    notes: it.notes ?? null,
    seq: it.seq ?? i + 1,
    not_before: it.not_before ?? null,
    status: "queued",
  }));
  const { error } = await supabase.from("group_admin_actions" as any).insert(rows as any);
  if (error) throw error;
  return rows.length;
}
