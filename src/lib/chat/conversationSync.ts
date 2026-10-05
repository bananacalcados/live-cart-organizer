import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Atualização INCREMENTAL da lista de conversas.
 * - Carga completa: `get_conversations_since(p_since = null)` (mesmo conjunto de get_conversations).
 * - Incremental: só linhas com `updated_at > watermark − 60s` (relógio do SERVIDOR), mescladas por chave.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const OVERLAP_MS = 60_000;
const FULL_RESYNC_MS = 10 * 60_000;
const EMPTY: Row[] = [];

export const conversationRowKey = (row: Row) => `${row.phone}__${row.whatsapp_number_id || "none"}`;

export async function fetchConversationsSince(params: {
  numberId: string | null;
  dispatchOnly: boolean | null;
  since: string | null;
}): Promise<{ rows: Row[]; full: boolean; error: Error | null }> {
  const { data, error } = await (supabase.rpc as any)("get_conversations_since", {
    p_number_id: params.numberId,
    p_dispatch_only: params.dispatchOnly,
    p_since: params.since,
  });
  if (!error) return { rows: (data || []) as Row[], full: params.since === null, error: null };

  console.warn("[conversationSync] get_conversations_since falhou, usando carga completa:", error.message);
  const fb = await supabase.rpc("get_conversations", {
    p_number_id: params.numberId as any,
    p_dispatch_only: params.dispatchOnly as any,
  });
  if (fb.error) return { rows: [], full: true, error: new Error(fb.error.message) };
  return { rows: (fb.data || []) as Row[], full: true, error: null };
}

/** Substitui por chave e acrescenta novas. `incoming` vazio → devolve `prev` (mesma referência). */
export function mergeConversationRows(prev: Row[], incoming: Row[]): Row[] {
  if (!incoming || incoming.length === 0) return prev;
  const byKey = new Map<string, Row>();
  for (const r of incoming) byKey.set(conversationRowKey(r), r);
  const next: Row[] = [];
  for (const r of prev) {
    const k = conversationRowKey(r);
    const repl = byKey.get(k);
    if (repl) { next.push(repl); byKey.delete(k); } else next.push(r);
  }
  byKey.forEach((r) => next.push(r));
  return next;
}

/** Maior `updated_at` recebido (hora do servidor). */
export function nextWatermark(prev: string | null, rows: Row[]): string | null {
  let best = prev ? Date.parse(prev) : NaN;
  let bestStr = prev;
  for (const r of rows) {
    const t = r?.updated_at ? Date.parse(r.updated_at) : NaN;
    if (!Number.isNaN(t) && (Number.isNaN(best) || t > best)) { best = t; bestStr = r.updated_at; }
  }
  return bestStr;
}

const sinceFrom = (wm: string) => new Date(Date.parse(wm) - OVERLAP_MS).toISOString();

/** Mesma conversa aberta? payload sem telefone → sim. 8+ dígitos nos dois → compara últimos 8. */
export function isSameOpenPhone(payloadPhone: string | null | undefined, openPhone: string | null | undefined): boolean {
  if (!payloadPhone) return true;
  if (!openPhone) return false;
  const a = payloadPhone.replace(/\D/g, "");
  const b = openPhone.replace(/\D/g, "");
  if (a.length >= 8 && b.length >= 8) return a.slice(-8) === b.slice(-8);
  return payloadPhone === openPhone;
}

/**
 * Linhas de UMA consulta (numberId + dispatchOnly) com carga completa ao habilitar/
 * trocar parâmetros e a cada 10 min (pausado com aba oculta), e incremental sob demanda.
 * Guarda de geração descarta respostas antigas; sem watermark não há incremental.
 */
export function useConversationRowsSync(opts: { enabled: boolean; numberId: string | null; dispatchOnly: boolean | null }) {
  const { enabled, numberId, dispatchOnly } = opts;
  const [rows, setRows] = useState<Row[]>(EMPTY);
  const genRef = useRef(0);
  const wmRef = useRef<string | null>(null);
  const paramsRef = useRef({ enabled, numberId, dispatchOnly });
  paramsRef.current = { enabled, numberId, dispatchOnly };

  const loadFull = useCallback(async () => {
    const p = paramsRef.current;
    if (!p.enabled) return;
    const gen = ++genRef.current;
    wmRef.current = null;
    const res = await fetchConversationsSince({ numberId: p.numberId, dispatchOnly: p.dispatchOnly, since: null });
    if (gen !== genRef.current) return;
    if (res.error) { console.error("Error loading conversations:", res.error); return; }
    setRows(res.rows);
    wmRef.current = nextWatermark(null, res.rows);
  }, []);

  const loadIncremental = useCallback(async () => {
    const p = paramsRef.current;
    if (!p.enabled) return;
    const wm = wmRef.current;
    if (!wm) return; // carga completa em andamento (ou sem updated_at) já resolve
    const gen = genRef.current;
    const res = await fetchConversationsSince({ numberId: p.numberId, dispatchOnly: p.dispatchOnly, since: sinceFrom(wm) });
    if (gen !== genRef.current) return;
    if (res.error) { console.error("Error loading conversations:", res.error); void loadFull(); return; }
    if (res.full) {
      setRows(res.rows);
      wmRef.current = nextWatermark(null, res.rows);
      return;
    }
    if (res.rows.length > 0) setRows((prev) => mergeConversationRows(prev, res.rows));
    wmRef.current = nextWatermark(wm, res.rows);
  }, [loadFull]);

  useEffect(() => {
    if (!enabled) {
      genRef.current++;
      wmRef.current = null;
      setRows(EMPTY);
      return;
    }
    void loadFull();
  }, [enabled, numberId, dispatchOnly, loadFull]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => { if (!document.hidden) void loadFull(); }, FULL_RESYNC_MS);
    return () => clearInterval(id);
  }, [enabled, loadFull]);

  return { rows, loadFull, loadIncremental };
}
