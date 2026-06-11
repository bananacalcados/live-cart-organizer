import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProductWaitEntry {
  id: string;
  phone: string;
  customer_name: string | null;
  whatsapp_number_id: string | null;
  store_id: string | null;
  pos_product_id: string | null;
  matched_pos_product_id: string | null;
  product_name: string;
  size: string | null;
  color: string | null;
  barcode: string | null;
  parent_sku: string | null;
  image_url: string | null;
  requested_by_user_id: string | null;
  requested_by_name: string | null;
  status: string;
  notes: string | null;
  arrived_at: string | null;
  notified_at: string | null;
  created_at: string;
}

const suffix = (p: string) => String(p || "").replace(/\D/g, "").slice(-8);

/**
 * Carrega e mantém em tempo real as anotações de "cliente aguardando reposição
 * de produto". Quando o estoque da variação exata (cor + tamanho) volta a ficar
 * positivo em qualquer loja, um gatilho no banco marca a anotação como `arrived`
 * e o realtime aqui dispara a atualização da UI.
 */
export function useProductWaitlist() {
  const [entries, setEntries] = useState<ProductWaitEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("product_wait_notifications")
      .select("*")
      .in("status", ["waiting", "arrived"])
      .order("created_at", { ascending: false });
    if (!error && data) setEntries(data as ProductWaitEntry[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("product_wait_notifications_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_wait_notifications" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const waiting = useMemo(() => entries.filter((e) => e.status === "waiting"), [entries]);
  const arrived = useMemo(() => entries.filter((e) => e.status === "arrived"), [entries]);

  // Telefones (sufixo de 8 dígitos) com qualquer anotação ativa — usado para
  // mover a conversa para a aba "Espera Produtos" e tirá-la das métricas de aberto.
  const waitingSuffixes = useMemo(
    () => new Set(entries.map((e) => suffix(e.phone))),
    [entries],
  );

  const markNotified = useCallback(
    async (id: string) => {
      await (supabase as any)
        .from("product_wait_notifications")
        .update({ status: "notified", notified_at: new Date().toISOString() })
        .eq("id", id);
      load();
    },
    [load],
  );

  const cancelEntry = useCallback(
    async (id: string) => {
      await (supabase as any)
        .from("product_wait_notifications")
        .update({ status: "cancelled" })
        .eq("id", id);
      load();
    },
    [load],
  );

  return {
    entries,
    waiting,
    arrived,
    waitingSuffixes,
    waitingCount: waiting.length,
    arrivedCount: arrived.length,
    loading,
    refresh: load,
    markNotified,
    cancelEntry,
  };
}
