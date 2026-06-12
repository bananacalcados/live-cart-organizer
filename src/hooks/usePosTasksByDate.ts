import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { todaySaoPaulo } from "@/lib/sellerTasks/recurrence";

export interface TaskContactRow {
  id: string;
  customer_phone: string | null;
  customer_name: string | null;
  customer_meta: any;
  contacted: boolean;
  contacted_at: string | null;
}

export interface TaskInstanceRow {
  id: string;
  definition_id: string;
  store_id: string;
  seller_id: string;
  due_date: string;
  status: "pending" | "completed";
  progress_current: number;
  progress_target: number;
  completion_mode: string | null;
  // joined definition
  title: string;
  description: string | null;
  category: string;
  verification_mode: "manual" | "auto";
  points_reward: number;
  target_count: number;
  contacts: TaskContactRow[];
}

/**
 * Garante (somente para hoje/passado) e carrega as instâncias de tarefas de TODAS
 * as vendedoras de uma loja para uma data específica, com seus contatos.
 */
export function usePosTasksByDate(storeId: string | null, dateStr: string) {
  const [instances, setInstances] = useState<TaskInstanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    const { data, error } = await supabase
      .from("pos_seller_task_instances" as any)
      .select("*, pos_task_definitions(title, description, category, verification_mode, points_reward, target_count)")
      .eq("store_id", storeId)
      .eq("due_date", dateStr);
    if (error) { console.error(error); return; }

    const ids = (data || []).map((i: any) => i.id);
    const contactsByInstance: Record<string, TaskContactRow[]> = {};
    if (ids.length) {
      const { data: contacts } = await supabase
        .from("pos_task_contacts" as any)
        .select("*")
        .in("instance_id", ids);
      for (const c of (contacts || []) as any[]) {
        (contactsByInstance[c.instance_id] ||= []).push(c);
      }
    }

    const mapped: TaskInstanceRow[] = (data || []).map((i: any) => ({
      id: i.id,
      definition_id: i.definition_id,
      store_id: i.store_id,
      seller_id: i.seller_id,
      due_date: i.due_date,
      status: i.status,
      progress_current: i.progress_current,
      progress_target: i.progress_target,
      completion_mode: i.completion_mode,
      title: i.pos_task_definitions?.title || "Tarefa",
      description: i.pos_task_definitions?.description || null,
      category: i.pos_task_definitions?.category || "custom",
      verification_mode: i.pos_task_definitions?.verification_mode || "manual",
      points_reward: i.pos_task_definitions?.points_reward || 0,
      target_count: i.pos_task_definitions?.target_count || 1,
      contacts: contactsByInstance[i.id] || [],
    }));
    setInstances(mapped);
  }, [storeId, dateStr]);

  const ensureAndLoad = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      // Só geramos instâncias reais para hoje ou datas passadas.
      if (dateStr <= todaySaoPaulo()) {
        await supabase.functions.invoke("pos-tasks-generate", {
          body: { storeId, date: dateStr },
        }).catch(() => {});
      }
      await load();
    } finally {
      setLoading(false);
    }
  }, [storeId, dateStr, load]);

  useEffect(() => { ensureAndLoad(); }, [ensureAndLoad]);

  const completeManual = useCallback(async (instanceId: string) => {
    await supabase
      .from("pos_seller_task_instances" as any)
      .update({ status: "completed", completion_mode: "manual", completed_at: new Date().toISOString(), progress_current: 1 })
      .eq("id", instanceId);
    await load();
  }, [load]);

  const uncomplete = useCallback(async (instanceId: string) => {
    await supabase
      .from("pos_seller_task_instances" as any)
      .update({ status: "pending", completion_mode: null, completed_at: null, progress_current: 0 })
      .eq("id", instanceId);
    await load();
  }, [load]);

  const markContacted = useCallback(async (contactId: string) => {
    await supabase
      .from("pos_task_contacts" as any)
      .update({ contacted: true, contacted_at: new Date().toISOString() })
      .eq("id", contactId);
    await load();
  }, [load]);

  return { instances, loading, refresh: load, ensureAndLoad, completeManual, uncomplete, markContacted };
}
