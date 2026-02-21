import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CrmPhoneEntry {
  name: string;
  source: 'pos_customer' | 'zoppy_customer' | 'campaign_lead' | 'customer';
  sourceId: string;
}

/**
 * Bulk CRM phone lookup using the `lookup_crm_by_phones` RPC.
 * Returns a Map<phone, CrmPhoneEntry> for all phones that have CRM data.
 *
 * Also exposes `deleteWhatsApp(phone)` to remove the phone from all matching CRM tables.
 */
export function useCrmPhoneLookup(phones: string[]) {
  const [crmMap, setCrmMap] = useState<Map<string, CrmPhoneEntry>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const prevKey = useRef('');

  const lookup = useCallback(async (phoneList: string[]) => {
    if (phoneList.length === 0) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc('lookup_crm_by_phones' as any, {
        p_phones: phoneList,
      });
      if (error) {
        console.error('CRM lookup error:', error);
        setIsLoading(false);
        return;
      }
      const map = new Map<string, CrmPhoneEntry>();
      for (const row of (data || []) as any[]) {
        map.set(row.phone, {
          name: row.crm_name,
          source: row.crm_source,
          sourceId: row.crm_source_id,
        });
      }
      setCrmMap(map);
    } catch (err) {
      console.error('CRM lookup error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const key = phones.slice().sort().join(',');
    if (key === prevKey.current || phones.length === 0) return;
    prevKey.current = key;
    lookup(phones);
  }, [phones, lookup]);

  /** Delete WhatsApp from all matching CRM tables for a given phone */
  const deleteWhatsApp = useCallback(async (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const suffix = cleanPhone.slice(-8);

    try {
      // Delete from all 3 tables in parallel
      const [r1, r2, r3] = await Promise.all([
        // customers: whatsapp column
        supabase
          .from('customers')
          .update({ whatsapp: null })
          .ilike('whatsapp', `%${suffix}`),
        // pos_customers: whatsapp column
        supabase
          .from('pos_customers')
          .update({ whatsapp: null } as any)
          .ilike('whatsapp' as any, `%${suffix}`),
        // zoppy_customers: phone column
        supabase
          .from('zoppy_customers')
          .update({ phone: null } as any)
          .ilike('phone' as any, `%${suffix}`),
      ]);

      const errors = [r1.error, r2.error, r3.error].filter(Boolean);
      if (errors.length > 0) {
        console.error('Errors deleting WhatsApp:', errors);
        toast.error('Erro parcial ao excluir WhatsApp');
      } else {
        toast.success('WhatsApp excluído do CRM');
      }

      // Remove from local map
      setCrmMap(prev => {
        const next = new Map(prev);
        next.delete(phone);
        return next;
      });
    } catch (err) {
      console.error('Error deleting WhatsApp:', err);
      toast.error('Erro ao excluir WhatsApp');
    }
  }, []);

  return { crmMap, isLoading, deleteWhatsApp, refresh: () => lookup(phones) };
}
