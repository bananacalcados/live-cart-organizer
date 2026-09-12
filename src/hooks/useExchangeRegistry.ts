import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { chargebackPhoneKey, cpfDigits, phoneSuffix8 } from "@/lib/chargebackKeys";

/** Troca/devolução registrada (trocas_devolucoes) enriquecida com o cliente da venda original. */
export interface ExchangeRecord {
  id: string;
  codigo_devolucao: string | null;
  tipo: "troca" | "devolucao";
  motivo: string | null;
  status: string;
  created_at: string;
  pedido_original_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_cpf: string | null;
  customer_unified_id: string | null;
}

export const EXCHANGE_TIPO_LABELS: Record<string, string> = {
  troca: "Troca",
  devolucao: "Devolução",
};

export const EXCHANGE_MOTIVO_LABELS: Record<string, string> = {
  defeito_avaria: "Defeito / Avaria",
  tamanho: "Tamanho errado",
  arrependimento: "Arrependimento",
  erro_expedicao: "Erro de expedição (nosso)",
  outro: "Outro",
};

export const EXCHANGE_STATUS_LABELS: Record<string, string> = {
  iniciada: "Iniciada",
  aguardando_retorno: "Aguardando retorno",
  recebido_conferencia: "Recebido / conferência",
  aguardando_envio: "Aguardando envio",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export interface ExchangeRegistry {
  loading: boolean;
  records: ExchangeRecord[];
  /** Trocas/devoluções de um telefone (match por DDD + 8 dígitos). */
  byPhone: (phone?: string | null) => ExchangeRecord[];
  /** Trocas/devoluções de um CPF. */
  byCpf: (cpf?: string | null) => ExchangeRecord[];
  /** Trocas/devoluções de um @ do Instagram (resolvido via cadastro unificado). */
  byHandle: (handle?: string | null) => ExchangeRecord[];
  /** Trocas/devoluções de uma venda específica (pos_sales.id). */
  bySale: (saleId?: string | null) => ExchangeRecord[];
  refresh: () => Promise<void>;
}

const clean = (h?: string | null) => (h || "").replace(/^@\s*/, "").trim().toLowerCase();

let cache: { records: ExchangeRecord[]; handles: Record<string, string[]> } | null = null;

/** Invalida o cache global — chamar após criar uma troca/devolução. */
export function invalidateExchangeRegistry() {
  cache = null;
}

/**
 * Registro global de trocas/devoluções (tabela pequena — dezenas de linhas)
 * usado para exibir a TAG nos pontos de contato: modal do cliente no chat,
 * painel de comentários da live e modal de pedido da live.
 */
export function useExchangeRegistry(): ExchangeRegistry {
  const [records, setRecords] = useState<ExchangeRecord[]>(cache?.records || []);
  const [handleMap, setHandleMap] = useState<Record<string, string[]>>(cache?.handles || {});
  const [loading, setLoading] = useState(!cache);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("trocas_devolucoes")
      .select("id, codigo_devolucao, tipo, motivo, status, created_at, pedido_original_id")
      .neq("status", "cancelada")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[useExchangeRegistry]", error);
      setLoading(false);
      return;
    }
    const rows = (data as any[]) || [];

    // Cliente da venda original (telefone/CPF/unificado)
    const saleIds = Array.from(new Set(rows.map((r) => r.pedido_original_id).filter(Boolean))) as string[];
    const saleById = new Map<string, any>();
    if (saleIds.length) {
      const { data: sales } = await supabase
        .from("pos_sales")
        .select("id, customer_name, customer_phone, customer_cpf, customer_unified_id")
        .in("id", saleIds);
      (sales as any[] | null)?.forEach((s) => saleById.set(s.id, s));
    }

    const enriched: ExchangeRecord[] = rows.map((r) => {
      const s = r.pedido_original_id ? saleById.get(r.pedido_original_id) : null;
      return {
        id: r.id,
        codigo_devolucao: r.codigo_devolucao || null,
        tipo: r.tipo,
        motivo: r.motivo || null,
        status: r.status,
        created_at: r.created_at,
        pedido_original_id: r.pedido_original_id || null,
        customer_name: s?.customer_name || null,
        customer_phone: s?.customer_phone || null,
        customer_cpf: s?.customer_cpf || null,
        customer_unified_id: s?.customer_unified_id || null,
      };
    });

    // Resolve @ do Instagram pelo cadastro unificado
    const unifiedIds = Array.from(
      new Set(enriched.map((r) => r.customer_unified_id).filter(Boolean)),
    ) as string[];
    const handles: Record<string, string[]> = {};
    if (unifiedIds.length) {
      const { data: uni } = await supabase
        .from("customers_unified")
        .select("id, instagram_handle")
        .in("id", unifiedIds);
      const byId = new Map<string, string>();
      (uni as any[] | null)?.forEach((u) => {
        const h = clean(u.instagram_handle);
        if (h) byId.set(u.id, h);
      });
      enriched.forEach((r) => {
        const h = r.customer_unified_id ? byId.get(r.customer_unified_id) : null;
        if (h) (handles[h] ||= []).push(r.id);
      });
    }

    cache = { records: enriched, handles };
    setRecords(enriched);
    setHandleMap(handles);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!cache) refresh();
  }, [refresh]);

  const byPhone = useCallback(
    (phone?: string | null) => {
      const key = chargebackPhoneKey(phone);
      const suf = phoneSuffix8(phone);
      if (!key && !suf) return [];
      return records.filter((r) => {
        const rk = chargebackPhoneKey(r.customer_phone);
        if (!rk) return false;
        return rk === key || (!!suf && rk.endsWith(suf));
      });
    },
    [records],
  );

  const byCpf = useCallback(
    (cpf?: string | null) => {
      const d = cpfDigits(cpf);
      if (!d) return [];
      return records.filter((r) => cpfDigits(r.customer_cpf) === d);
    },
    [records],
  );

  const byHandle = useCallback(
    (handle?: string | null) => {
      const h = clean(handle);
      if (!h) return [];
      const ids = new Set(handleMap[h] || []);
      return ids.size ? records.filter((r) => ids.has(r.id)) : [];
    },
    [records, handleMap],
  );

  const bySale = useCallback(
    (saleId?: string | null) => (saleId ? records.filter((r) => r.pedido_original_id === saleId) : []),
    [records],
  );

  return { loading, records, byPhone, byCpf, byHandle, bySale, refresh };
}
