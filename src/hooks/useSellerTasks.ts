import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface TaskContact {
  id: string;
  customer_phone: string | null;
  customer_name: string | null;
  customer_meta: any;
  contacted: boolean;
  contacted_at: string | null;
}

export interface TaskInstance {
  id: string;
  definition_id: string;
  store_id: string;
  seller_id: string;
  status: "pending" | "completed";
  progress_current: number;
  progress_target: number;
  completion_mode: string | null;
  payload: any;
  // joined
  title: string;
  description: string | null;
  category: string;
  verification_mode: "manual" | "auto";
  points_reward: number;
  contacts: TaskContact[];
}

function todaySaoPaulo(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date());
}

export function useSellerTasks(storeId: string | null, sellerId: string | null) {
  const [instances, setInstances] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const load = useCallback(async () => {
    if (!storeId || !sellerId) return;
    const date = todaySaoPaulo();
    const { data, error } = await supabase
      .from("pos_seller_task_instances" as any)
      .select("*, pos_task_definitions(title, description, category, verification_mode, points_reward)")
      .eq("seller_id", sellerId)
      .eq("due_date", date);
    if (error) { console.error(error); return; }

    const ids = (data || []).map((i: any) => i.id);
    let contactsByInstance: Record<string, TaskContact[]> = {};
    if (ids.length) {
      const { data: contacts } = await supabase
        .from("pos_task_contacts" as any)
        .select("*")
        .in("instance_id", ids);
      for (const c of (contacts || []) as any[]) {
        (contactsByInstance[c.instance_id] ||= []).push(c);
      }
    }

    const mapped: TaskInstance[] = (data || []).map((i: any) => ({
      id: i.id,
      definition_id: i.definition_id,
      store_id: i.store_id,
      seller_id: i.seller_id,
      status: i.status,
      progress_current: i.progress_current,
      progress_target: i.progress_target,
      completion_mode: i.completion_mode,
      payload: i.payload,
      title: i.pos_task_definitions?.title || "Tarefa",
      description: i.pos_task_definitions?.description || null,
      category: i.pos_task_definitions?.category || "custom",
      verification_mode: i.pos_task_definitions?.verification_mode || "manual",
      points_reward: i.pos_task_definitions?.points_reward || 0,
      contacts: contactsByInstance[i.id] || [],
    }));
    setInstances(mapped);
  }, [storeId, sellerId]);

  // Garante as instâncias do dia e carrega
  const ensureAndLoad = useCallback(async () => {
    if (!storeId || !sellerId) return;
    setLoading(true);
    try {
      await supabase.functions.invoke("pos-tasks-generate", {
        body: { storeId, sellerId },
      }).catch(() => {});
      await load();
      setGenerated(true);
    } finally {
      setLoading(false);
    }
  }, [storeId, sellerId, load]);

  useEffect(() => {
    if (storeId && sellerId && !generated) ensureAndLoad();
  }, [storeId, sellerId, generated, ensureAndLoad]);

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

  // Marca um contato como falado (a trigger do banco conclui a instância ao bater a meta)
  const markContacted = useCallback(async (contactId: string) => {
    await supabase
      .from("pos_task_contacts" as any)
      .update({ contacted: true, contacted_at: new Date().toISOString() })
      .eq("id", contactId);
    await load();
  }, [load]);

  const pendingCount = instances.filter((i) => i.status !== "completed").length;

  return { instances, loading, pendingCount, refresh: load, ensureAndLoad, completeManual, uncomplete, markContacted };
}
