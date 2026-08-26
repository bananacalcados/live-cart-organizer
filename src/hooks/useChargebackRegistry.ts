import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { chargebackPhoneKey, cpfDigits, phoneSuffix8 } from "@/lib/chargebackKeys";
import type { ChargebackRecord } from "@/hooks/useCustomerChargebacks";

const SELECT =
  "id, status, blocked, amount, chargeback_date, reason, source, source_order_name, pos_sale_id, order_id, customer_name, customer_phone, customer_cpf, customer_unified_id, phone_key, cpf_digits, created_at";

export interface ChargebackRegistry {
  loading: boolean;
  records: ChargebackRecord[];
  /** Chargebacks de um telefone (match por DDD + 8 dígitos). */
  byPhone: (phone?: string | null) => ChargebackRecord[];
  /** Chargebacks de um CPF. */
  byCpf: (cpf?: string | null) => ChargebackRecord[];
  /** Chargebacks de um @ do Instagram (resolvido via cadastro unificado). */
  byHandle: (handle?: string | null) => ChargebackRecord[];
  refresh: () => Promise<void>;
}

const clean = (h?: string | null) => (h || "").replace(/^@\s*/, "").trim().toLowerCase();

let cache: { records: any[]; handles: Record<string, string[]> } | null = null;

/**
 * Registro global de chargebacks (tabela pequena) usado para exibir a TAG
 * em pontos de contato: chat do WhatsApp, painel de comentários da live,
 * modal de novo pedido e expedição.
 */
export function useChargebackRegistry(): ChargebackRegistry {
  const [records, setRecords] = useState<ChargebackRecord[]>(
    (cache?.records as ChargebackRecord[]) || [],
  );
  const [handleMap, setHandleMap] = useState<Record<string, string[]>>(cache?.handles || {});
  const [loading, setLoading] = useState(!cache);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("chargebacks")
      .select(SELECT)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[useChargebackRegistry]", error);
      setLoading(false);
      return;
    }
    const rows = (data as any[]) || [];

    // Resolve @ do Instagram pelo cadastro unificado (chargeback -> cliente unificado)
    const unifiedIds = Array.from(
      new Set(rows.map((r) => r.customer_unified_id).filter(Boolean)),
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
      rows.forEach((r) => {
        const h = r.customer_unified_id ? byId.get(r.customer_unified_id) : null;
        if (h) (handles[h] ||= []).push(r.id);
      });
    }

    cache = { records: rows, handles };
    setRecords(rows as ChargebackRecord[]);
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
      return records.filter((r: any) => {
        const rk = r.phone_key || chargebackPhoneKey(r.customer_phone);
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
      return records.filter((r: any) => (r.cpf_digits || cpfDigits(r.customer_cpf)) === d);
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

  return { loading, records, byPhone, byCpf, byHandle, refresh };
}
