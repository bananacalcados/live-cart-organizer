import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CashbackEntry {
  /** Soma de todos os cashbacks ativos (não usados e dentro da validade) */
  totalAvailable: number;
  /** Quantidade de cupons de cashback ativos */
  count: number;
  /** Código do cupom mais recente */
  couponCode: string;
  /** Valor do cupom mais recente */
  amount: number;
  /** Compra mínima do cupom mais recente */
  minPurchase: number;
  /** Data em que o cupom mais recente foi gerado */
  generatedAt: string;
  /** Validade do cupom mais recente */
  expiresAt: string;
}

/**
 * Consulta em lote o cashback disponível por telefone via RPC
 * `lookup_cashback_by_phones`. Retorna um Map<phone, CashbackEntry> apenas
 * para os telefones que possuem cashback ativo.
 */
export function useCashbackLookup(phones: string[]) {
  const [cashbackMap, setCashbackMap] = useState<Map<string, CashbackEntry>>(new Map());
  const prevKey = useRef('');

  const lookup = useCallback(async (phoneList: string[]) => {
    if (phoneList.length === 0) return;
    try {
      const { data, error } = await supabase.rpc('lookup_cashback_by_phones' as any, {
        p_phones: phoneList,
      });
      if (error) {
        console.error('Cashback lookup error:', error);
        return;
      }
      const map = new Map<string, CashbackEntry>();
      for (const row of (data || []) as any[]) {
        map.set(row.phone, {
          totalAvailable: Number(row.total_available) || 0,
          count: Number(row.cashback_count) || 0,
          couponCode: row.coupon_code,
          amount: Number(row.cashback_amount) || 0,
          minPurchase: Number(row.min_purchase) || 0,
          generatedAt: row.generated_at,
          expiresAt: row.expires_at,
        });
      }
      setCashbackMap(map);
    } catch (err) {
      console.error('Cashback lookup error:', err);
    }
  }, []);

  useEffect(() => {
    const key = phones.slice().sort().join(',');
    if (key === prevKey.current || phones.length === 0) return;
    prevKey.current = key;
    lookup(phones);
  }, [phones, lookup]);

  return { cashbackMap, refresh: () => lookup(phones) };
}
