export const LIVE_SYNC_SECOND_PASS_MS = 30_000;
export function liveAccountName(url: string | null | undefined): string | null {
  return url?.match(/instagram\.com\/([^/?#]+)\/live\//i)?.[1]?.toLowerCase() || null;
}
export function selectLiveAccounts<T extends { instagram_username: string | null; label: string | null }>(rows: T[], url: string | null | undefined): T[] {
  const name = liveAccountName(url);
  if (!name) return rows;
  const matches = rows.filter(row => [row.instagram_username, row.label].some(v => v?.replace(/^@/, '').trim().toLowerCase() === name));
  return matches.length ? matches : rows;
}