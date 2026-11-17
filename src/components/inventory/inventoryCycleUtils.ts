export interface InventoryReportRow {
  pos_product_id: string | null;
  variant_id: string | null;
  master_id: string | null;
  product_name: string | null;
  code: string | null;
  color: string | null;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  stock: number | null;
  status: string;
  labels: number | null;
  last_batch_numero: number | null;
  last_batch_at: string | null;
  last_mode: string | null;
  total_count: number | null;
}

export const INVENTORY_STATUS_LABELS: Record<string, string> = {
  contado: "Contado",
  impresso: "Etiqueta impressa, sem balanço",
  nao_impresso: "Não contado",
  zerado: "Zerado neste inventário",
  sem_codigo: "Sem código",
};

export interface ZeroUnprintedParams {
  p_cycle_id: string;
  p_confirm: "ZERAR";
  p_user_name?: string;
  p_max: 100;
}

export interface ZeroUnprintedResult {
  numero?: number;
  batch_id?: string;
  changed?: number;
  total_delta?: number;
  remaining?: number;
}

type ZeroRpc = (params: ZeroUnprintedParams) => Promise<{
  data: ZeroUnprintedResult | null;
  error: { message: string } | null;
}>;

export interface ZeroRunProgress {
  done: number;
  total: number;
  remaining: number;
}

export interface ZeroRunResult extends ZeroRunProgress {
  calls: number;
  stopped: boolean;
  noProgress: boolean;
  error: string | null;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Runs one database call at a time and always checks the stop flag before the next call. */
export async function runInventoryZero({
  cycleId,
  userName,
  total,
  rpc,
  shouldStop,
  onProgress,
  pause = wait,
}: {
  cycleId: string;
  userName?: string;
  total: number;
  rpc: ZeroRpc;
  shouldStop: () => boolean;
  onProgress?: (progress: ZeroRunProgress) => void;
  pause?: (milliseconds: number) => Promise<void>;
}): Promise<ZeroRunResult> {
  let done = 0;
  let remaining = total;
  let calls = 0;

  const result = (extra: Partial<ZeroRunResult> = {}): ZeroRunResult => ({
    done,
    total,
    remaining,
    calls,
    stopped: false,
    noProgress: false,
    error: null,
    ...extra,
  });

  while (remaining > 0) {
    if (shouldStop()) return result({ stopped: true });
    calls += 1;

    try {
      const { data, error } = await rpc({
        p_cycle_id: cycleId,
        p_confirm: "ZERAR",
        p_user_name: userName || undefined,
        p_max: 100,
      });
      if (error) return result({ error: error.message });

      const changed = Math.max(0, Number(data?.changed || 0));
      done += changed;
      remaining = Math.max(0, Number(data?.remaining || 0));
      onProgress?.({ done, total, remaining });

      if (changed === 0) return result({ noProgress: remaining > 0 });
      if (remaining === 0) return result();
    } catch (error: any) {
      return result({ error: error?.message || String(error) });
    }

    if (shouldStop()) return result({ stopped: true });
    await pause(1500);
  }

  return result();
}

export async function fetchAllInventoryReport(
  fetchPage: (limit: number, offset: number) => Promise<InventoryReportRow[]>,
): Promise<InventoryReportRow[]> {
  const allRows: InventoryReportRow[] = [];
  let offset = 0;

  while (true) {
    const rows = await fetchPage(500, offset);
    allRows.push(...rows);
    const totalCount = Number(rows[0]?.total_count || 0);
    offset += rows.length;
    if (rows.length < 500 || (totalCount > 0 && allRows.length >= totalCount)) break;
  }

  return allRows;
}

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export function buildInventoryCsv(rows: InventoryReportRow[], dateTime: (value: string | null) => string): string {
  const headers = [
    "Produto", "Código", "SKU", "Código de barras", "Cor", "Tamanho",
    "Saldo no sistema", "Situação", "Etiquetas", "Último lote", "Data do último lote",
  ];
  const lines = rows.map((row) => [
    row.product_name,
    row.code,
    row.sku,
    row.barcode,
    row.color,
    row.size,
    row.stock ?? 0,
    INVENTORY_STATUS_LABELS[row.status] || row.status,
    row.labels ?? 0,
    row.last_batch_numero ? `#${row.last_batch_numero}` : "",
    row.last_batch_at ? dateTime(row.last_batch_at) : "",
  ].map(csvCell).join(";"));

  return `\uFEFF${[headers.map(csvCell).join(";"), ...lines].join("\r\n")}`;
}
