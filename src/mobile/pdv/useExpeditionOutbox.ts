import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { matchExpeditionScan } from "@/lib/pos/expeditionScanMatch";
import { acknowledgeScans, activeScans, scanBatch, scanTotals, type LocalExpeditionScan } from "@/lib/pos/expeditionOutbox";
import type { ExpOrder } from "@/lib/pos/expedition";

export function useExpeditionOutbox(order: ExpOrder, userId: string) {
  const key = `pdv-scans:${userId}:${order.id}`;
  const snapshot = order.updated_at || order.expedition_stage;
  const [rows, setRows] = useState<LocalExpeditionScan[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
  });
  const current = useRef(rows);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const busy = useRef(false);
  const reading = useRef(false);
  const persist = (next: LocalExpeditionScan[]) => {
    // Persistence MUST succeed before acknowledging a scan in the UI.
    localStorage.setItem(key, JSON.stringify(next));
    current.current = next;
    setRows(next);
  };

  const sync = async () => {
    if (busy.current || !navigator.onLine) return;
    busy.current = true; setSyncing(true);
    try {
      // Codes read offline are validated by the same resolver once connected.
      const candidates = current.current.filter(r => !r.sale_item_id && !r.error && !r.undo_of);
      for (const row of candidates) {
        if (!current.current.some(r => r.id === row.id)) continue;
        const totals = scanTotals(current.current, snapshot);
        const result = await matchExpeditionScan(order.items, row.code_read, item => (totals[item.id] || 0) < item.quantity, order.store_id, true);
        persist(current.current.map(r => r.id === row.id ? result.item
          ? { ...r, sale_item_id: result.item.id, sale_id: result.item.sale_id || order.id, method: result.resolved ? "etiqueta_nova" : "codigo_antigo", variant_code: result.resolved?.code, variant_id: result.resolved?.variant_id }
          : { ...r, error: result.alreadyScanned ? "Item bipado a mais" : "Item errado: não pertence ao pedido" } : r));
      }
      while (navigator.onLine) {
        const batch = scanBatch(current.current);
        if (!batch.length) break;
        const { data, error: failure } = await supabase.rpc("pos_expedition_scan_batch", { p_entries: batch });
        if (failure) throw failure;
        const ids = Array.isArray(data) ? data.map(String) : [];
        if (ids.length !== batch.length) throw new Error("Não consegui confirmar a gravação dos bipes");
        persist(acknowledgeScans(current.current, ids));
      }
      setError(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Bipes pendentes: tente sincronizar novamente"); }
    finally { busy.current = false; setSyncing(false); }
  };
  const syncRef = useRef(sync); syncRef.current = sync;
  useEffect(() => {
    const connect = () => { setOnline(true); void syncRef.current(); };
    const disconnect = () => setOnline(false);
    window.addEventListener("online", connect); window.addEventListener("offline", disconnect);
    void syncRef.current();
    return () => { window.removeEventListener("online", connect); window.removeEventListener("offline", disconnect); };
  }, [key]);

  const scan = async (code: string) => {
    if (!code.trim() || reading.current) return null;
    reading.current = true;
    try {
      const totals = scanTotals(current.current, snapshot);
      const result = await matchExpeditionScan(order.items, code, item => (totals[item.id] || 0) < item.quantity,
        order.store_id, true, navigator.onLine ? undefined : async () => { throw new Error("offline"); });
      if (!result.item) throw new Error(result.alreadyScanned ? "Item bipado a mais" : "Item errado: não pertence ao pedido");
      const row: LocalExpeditionScan = { id: crypto.randomUUID(), sale_id: result.item.sale_id || order.id, sale_item_id: result.item.id,
        code_read: code, method: result.resolved ? "etiqueta_nova" : "codigo_antigo", variant_code: result.resolved?.code,
        variant_id: result.resolved?.variant_id, acknowledged: false, snapshot };
      persist([...current.current, row]);
      void syncRef.current();
      return result.item;
    } catch (failure) {
      if (!navigator.onLine && failure instanceof Error && failure.message === "offline") {
        persist([...current.current, { id: crypto.randomUUID(), sale_id: order.id, code_read: code, method: "etiqueta_nova", acknowledged: false, snapshot }]);
        setError("Etiqueta guardada; será validada quando a internet voltar.");
        return null;
      }
      throw failure;
    } finally { reading.current = false; }
  };

  const undo = () => {
    if (busy.current || reading.current) { setError("Aguarde a sincronização para desfazer o último bipe."); return; }
    const last = activeScans(current.current, snapshot).at(-1);
    if (!last) return;
    if (!last.sale_item_id || last.error) {
      persist(current.current.filter(r => r.id !== last.id));
    } else {
      persist([...current.current, { ...last, id: crypto.randomUUID(), method: "desfeito", undo_of: last.id, acknowledged: false }]);
      void syncRef.current();
    }
  };
  const reset = () => { localStorage.removeItem(key); current.current = []; setRows([]); };
  return { rows, totals: scanTotals(rows, snapshot), pending: rows.filter(row => !row.acknowledged).length,
    error, online, syncing, scan, sync, undo, reset,
    stale: rows.some(row => row.snapshot !== snapshot && !row.undo_of), invalid: rows.some(row => row.error) };
}