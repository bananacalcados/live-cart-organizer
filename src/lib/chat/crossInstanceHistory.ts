export type InstanceMessageCount = { whatsapp_number_id: string; message_count: number };
export type InstanceLabel = { id: string; label: string };

export const FEW_MESSAGES_LIMIT = 3;

export function otherInstanceHistory(
  counts: InstanceMessageCount[],
  currentNumberId: string | null,
  currentMessageCount: number,
  instances: InstanceLabel[],
): InstanceMessageCount & { label: string } | null {
  if (currentMessageCount > FEW_MESSAGES_LIMIT) return null;
  const candidates = counts
    .filter((row) => row.whatsapp_number_id && row.whatsapp_number_id !== currentNumberId && row.message_count > 0)
    .sort((a, b) => b.message_count - a.message_count || a.whatsapp_number_id.localeCompare(b.whatsapp_number_id));
  const best = candidates[0];
  if (!best) return null;
  return { ...best, label: instances.find((item) => item.id === best.whatsapp_number_id)?.label || "outra instância" };
}
