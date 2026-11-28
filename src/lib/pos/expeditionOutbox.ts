export interface LocalExpeditionScan {
  id: string;
  sale_id: string;
  sale_item_id?: string;
  method: "codigo_antigo" | "etiqueta_nova" | "desfeito";
  code_read: string;
  variant_code?: string | null;
  variant_id?: string | null;
  undo_of?: string;
  acknowledged: boolean;
  snapshot: string;
  error?: string;
}

export function activeScans(rows: LocalExpeditionScan[], snapshot: string) {
  const undone = new Set(rows.filter(row => row.undo_of).map(row => row.undo_of));
  return rows.filter(row => row.snapshot === snapshot && !row.undo_of && !undone.has(row.id));
}
export function scanTotals(rows: LocalExpeditionScan[], snapshot: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of activeScans(rows, snapshot)) if (row.sale_item_id && !row.error) counts[row.sale_item_id] = (counts[row.sale_item_id] || 0) + 1;
  return counts;
}
export function acknowledgeScans(rows: LocalExpeditionScan[], ids: string[]) {
  const ack = new Set(ids);
  return rows.map(row => ack.has(row.id) && !row.acknowledged ? { ...row, acknowledged: true } : row);
}
export function scanBatch(rows: LocalExpeditionScan[]) {
  return rows.filter(row => !row.acknowledged && row.sale_item_id && !row.error).slice(0, 100)
    .map(({ id, sale_id, sale_item_id, method, code_read, variant_code, variant_id }) => ({ id, sale_id, sale_item_id, method, code_read, variant_code: variant_code || null, variant_id: variant_id || null }));
}