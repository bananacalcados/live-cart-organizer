export interface LegacySummary { variant_count: number; total_stock: number; }
export interface LegacyThumbRow { master_id: string; color_key: string; url_thumb: string; position: number; created_at: string; }

export function firstLegacyThumbnails(rows: LegacyThumbRow[]): Record<string, string> {
  const first = new Map<string, LegacyThumbRow>();
  for (const row of rows) {
    const current = first.get(row.master_id);
    const replacesGeneral = current?.color_key === "geral" && row.color_key !== "geral";
    const keepsColor = current && current.color_key !== "geral" && row.color_key === "geral";
    if (!current || replacesGeneral || (!keepsColor && (row.position < current.position ||
      (row.position === current.position && row.created_at < current.created_at)))) first.set(row.master_id, row);
  }
  return Object.fromEntries([...first].map(([id, row]) => [id, row.url_thumb]));
}

export function legacySummaryMap(ids: string[], rows: (LegacySummary & { master_id: string })[]): Record<string, LegacySummary> {
  const map = Object.fromEntries(ids.map(id => [id, { variant_count: 0, total_stock: 0 }]));
  for (const row of rows) map[row.master_id] = { variant_count: Number(row.variant_count) || 0, total_stock: Number(row.total_stock) || 0 };
  return map;
}