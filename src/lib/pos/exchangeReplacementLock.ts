// Espelha a trava do servidor (guard_exchange_replacement_sale) para a tela da Expedição.
export interface ExchangeLockRow { pedido_novo_id: string; codigo_devolucao: string; status: string; modo_expedicao: string }
export interface ExchangeLock { code: string; canDelete: false; canConclude: boolean }

const OPEN_WAITING = ["iniciada", "aguardando_retorno", "recebido_conferencia"];

export function exchangeLockFor(row: ExchangeLockRow | null | undefined): ExchangeLock | null {
  if (!row || row.status === "cancelada" || row.status === "concluida") return null;
  const waiting = row.modo_expedicao === "aguarda_retorno" && OPEN_WAITING.includes(row.status);
  return { code: row.codigo_devolucao, canDelete: false, canConclude: !waiting };
}

export function buildExchangeLocks(rows: ExchangeLockRow[]): Record<string, ExchangeLock> {
  const out: Record<string, ExchangeLock> = {};
  for (const r of rows) { const l = exchangeLockFor(r); if (l && !out[r.pedido_novo_id]) out[r.pedido_novo_id] = l; }
  return out;
}
