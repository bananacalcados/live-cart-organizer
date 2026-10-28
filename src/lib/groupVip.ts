export function applyManualVip<T extends { group_jid_base: string; is_vip: boolean }>(rows: T[], base: string, value: boolean): T[] {
  return rows.map(row => row.group_jid_base === base && row.is_vip !== value ? { ...row, is_vip: value } : row);
}