// deno-lint-ignore-file no-explicit-any
/** Mantém o vínculo atual @ ↔ ID sem exigir ON CONFLICT em lower(username). */
export async function rememberInstagramIdentity(
  sb: any,
  input: { username: string; igUserId: string; source: string; seenAt: string },
): Promise<void> {
  const username = input.username.replace(/^@+/, '').trim().toLowerCase();
  if (!username || !input.igUserId) return;
  const table = () => sb.from('instagram_user_links');
  const read = async () => {
    const { data, error } = await table().select('id,ig_user_id,previous_ig_user_ids,last_seen_at').eq('username', username).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  };
  const existing = await read();
  const seenTime = Date.parse(input.seenAt);
  if (existing?.last_seen_at && Date.parse(existing.last_seen_at) >= seenTime) return;
  if (existing?.id) {
    const previous = existing.ig_user_id && existing.ig_user_id !== input.igUserId
      ? [...new Set([...(existing.previous_ig_user_ids || []), existing.ig_user_id])]
      : existing.previous_ig_user_ids || [];
    const { error } = await table().update({ ig_user_id: input.igUserId, previous_ig_user_ids: previous, source: input.source, last_seen_at: input.seenAt }).eq('id', existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await table().insert({ username, ig_user_id: input.igUserId, source: input.source, last_seen_at: input.seenAt });
  if ((error as any)?.code === '23505') {
    const raced = await read();
    if (raced?.id && (!raced.last_seen_at || Date.parse(raced.last_seen_at) < seenTime)) {
      const previous = raced.ig_user_id && raced.ig_user_id !== input.igUserId
        ? [...new Set([...(raced.previous_ig_user_ids || []), raced.ig_user_id])]
        : raced.previous_ig_user_ids || [];
      const { error: updateError } = await table().update({ ig_user_id: input.igUserId, previous_ig_user_ids: previous, source: input.source, last_seen_at: input.seenAt }).eq('id', raced.id);
      if (updateError) throw updateError;
    }
    return;
  }
  if (error) throw error;
}
