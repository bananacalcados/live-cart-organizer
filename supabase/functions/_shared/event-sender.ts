/** One server resolver for self-service and live follow-up. No conversation/global fallback. */
export async function resolveEventNumber(sb: any, eventId: string, fallbackId: string | null = null) {
  const { data, error } = await sb.rpc('live_event_sender', { p_event_id: eventId });
  if (error) throw error;
  return { id: data?.id || fallbackId || null, targetPhone: data?.target_phone || null };
}