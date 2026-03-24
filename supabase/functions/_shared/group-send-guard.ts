export function isLikelyGroupId(groupId?: string | null): boolean {
  if (!groupId) return false;
  return groupId.includes('@g.us') || groupId.endsWith('-group') || groupId.startsWith('120');
}

function extractPauseUntil(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.until === 'string') return record.until;
    if (typeof record.paused_until === 'string') return record.paused_until;
    if (typeof record.value === 'string') return record.value;
  }

  return null;
}

export async function getPausedGroupSendUntil(supabase: any): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value, updated_at')
    .eq('key', 'vip_group_sends_pause')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error || !data?.length) return null;

  const until = extractPauseUntil(data[0].value);
  if (!until) return null;

  const untilMs = Date.parse(until);
  if (Number.isNaN(untilMs) || untilMs <= Date.now()) return null;

  return new Date(untilMs).toISOString();
}