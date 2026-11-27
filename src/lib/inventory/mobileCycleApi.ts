import { supabase } from "@/integrations/supabase/client";
import { resolveInventoryProductCode } from "@/lib/inventoryStockCode";

const rpc = (name: string, args: Record<string, unknown>) => (supabase.rpc as any)(name, args);

export interface CycleInfo { id: string; numero: number; store_id: string; started_at: string; created_by_name: string | null }
export interface ScannedVariant { variant_id: string; master_id: string | null; name: string; color: string | null; size: string | null; code: string }
export type ZeroScope = "touched" | "store";

export async function getOpenCycle(storeId: string): Promise<CycleInfo | null> {
  const { data } = await supabase.from("stock_inventory_cycles" as any)
    .select("id,numero,store_id,started_at,created_by_name").eq("store_id", storeId).eq("status", "open").maybeSingle();
  return (data as any) || null;
}

/** Mesma abertura do Inventário do computador (uma loja = um inventário aberto). */
export async function openCycle(storeId: string, userName?: string): Promise<string> {
  const { data, error } = await rpc("stock_cycle_open", { p_store_id: storeId, p_name: "Balanço por bipagem (celular)", p_user_name: userName });
  if (error) throw error;
  return data.cycle_id;
}

/** Código interno, GTIN/SKU da variação ou código das linhas do PDV. */
export async function resolveScannedCode(code: string, _storeId: string): Promise<ScannedVariant | null> {
  const c = code.trim();
  if (!c) return null;
  const r = await resolveInventoryProductCode(c);
  if (!r?.variant_id) return null;
  return { variant_id: r.variant_id, master_id: r.master_id, name: r.master_name || c, color: r.color, size: r.size, code: r.code || c };
}

export async function submitCounts(p: { cycleId: string; deviceId: string; userName?: string;
  items: { variant_id: string; qty: number; since: string }[]; pendingLeft: number; finished?: boolean }) {
  const { data, error } = await rpc("mobile_cycle_submit", {
    p_cycle_id: p.cycleId, p_device_id: p.deviceId, p_items: p.items, p_user_name: p.userName,
    p_pending_left: p.pendingLeft, p_finished: !!p.finished,
  });
  if (error) throw error;
  return data as { applied_variants: number; changed: number; batches: number };
}

export async function loadConference(cycleId: string, scope: ZeroScope, search?: string, offset = 0) {
  const { data, error } = await rpc("mobile_cycle_conference", {
    p_cycle_id: cycleId, p_scope: scope, p_search: search?.trim() || null, p_limit: 50, p_offset: offset,
  });
  if (error) throw error;
  return data as {
    cycle: { numero: number; status: string; closed_at: string | null };
    counted_pairs: number; counted_variants: number; zero_variants: number; zero_pairs: number;
    zero_cost: number; zero_sale: number; store_pairs: number;
    devices: { device_id: string; user_name: string | null; last_sent_at: string | null; pending_left: number; finished: boolean }[];
    zero_list: { product_name: string; code: string | null; color: string | null; size: string | null; stock: number }[];
    counted_list: { variant_id: string; product_name: string; color: string | null; size: string | null; total: number; by_person: { user_name: string; qty: number }[] }[];
  };
}

/** Zera 100 por vez, parando quando pedido (mesmo ritmo do computador). */
export async function runZero(p: { cycleId: string; scope: ZeroScope; confirmPairs: number; userName?: string;
  shouldStop: () => boolean; onProgress: (done: number, remaining: number) => void; pause?: (ms: number) => Promise<void> }) {
  const pause = p.pause ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let done = 0;
  for (;;) {
    if (p.shouldStop()) return { done, stopped: true };
    const { data, error } = await rpc("mobile_cycle_zero", {
      p_cycle_id: p.cycleId, p_scope: p.scope, p_confirm: "ZERAR", p_confirm_pairs: p.confirmPairs, p_user_name: p.userName,
    });
    if (error) throw error;
    done += Number(data?.changed || 0);
    const remaining = Number(data?.remaining || 0);
    p.onProgress(done, remaining);
    if (remaining === 0 || Number(data?.changed || 0) === 0) return { done, stopped: false };
    await pause(1500);
  }
}

export async function closeCycle(cycleId: string, userName?: string) {
  const { error } = await rpc("stock_cycle_close", { p_cycle_id: cycleId, p_user_name: userName });
  if (error) throw error;
}

export async function revertCycle(cycleId: string, userName?: string) {
  const { data, error } = await rpc("mobile_cycle_revert", { p_cycle_id: cycleId, p_user_name: userName });
  if (error) throw error;
  return data as { reverted_batches: number; skipped: { numero: number; reason: string }[] };
}
