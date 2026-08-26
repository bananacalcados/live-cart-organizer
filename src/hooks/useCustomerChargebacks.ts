import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { chargebackPhoneKey, cpfDigits, phoneSuffix8 } from "@/lib/chargebackKeys";

export interface ChargebackRecord {
  id: string;
  status: string;
  blocked: boolean;
  amount: number | null;
  chargeback_date: string | null;
  reason: string | null;
  source: string | null;
  source_order_name: string | null;
  pos_sale_id: string | null;
  order_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_cpf: string | null;
  created_at: string;
}

const SELECT =
  "id, status, blocked, amount, chargeback_date, reason, source, source_order_name, pos_sale_id, order_id, customer_name, customer_phone, customer_cpf, created_at";

interface Identity {
  phone?: string | null;
  cpf?: string | null;
  unifiedId?: string | null;
}

/** Busca chargebacks do cliente por telefone normalizado, CPF ou cliente unificado. */
export function useCustomerChargebacks({ phone, cpf, unifiedId }: Identity) {
  const [items, setItems] = useState<ChargebackRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const key = chargebackPhoneKey(phone);
  const suffix = phoneSuffix8(phone);
  const cpfKey = cpfDigits(cpf);

  const refresh = useCallback(async () => {
    if (!key && !cpfKey && !unifiedId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const filters: string[] = [];
    if (key) filters.push(`phone_key.eq.${key}`);
    if (suffix) filters.push(`phone_key.like.%${suffix}`);
    if (cpfKey) filters.push(`cpf_digits.eq.${cpfKey}`);
    if (unifiedId) filters.push(`customer_unified_id.eq.${unifiedId}`);

    const { data, error } = await supabase
      .from("chargebacks")
      .select(SELECT)
      .or(filters.join(","))
      .order("created_at", { ascending: false });

    if (error) console.error("[useCustomerChargebacks]", error);
    setItems(((data as any[]) || []) as ChargebackRecord[]);
    setLoading(false);
  }, [key, suffix, cpfKey, unifiedId]);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    chargebacks: items,
    loading,
    refresh,
    hasChargeback: items.length > 0,
    isBlocked: items.some((c) => c.blocked),
  };
}
