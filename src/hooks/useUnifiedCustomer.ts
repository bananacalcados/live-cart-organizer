/**
 * Hook reativo para um cliente unificado a partir de qualquer chave.
 *
 * Uso:
 *   const { customer, loading } = useUnifiedCustomer({ phone: '5533...' });
 *   const { customer } = useUnifiedCustomer({ cpf: '123...' });
 *   const { customer } = useUnifiedCustomer({ instagram: '@joao' });
 *
 * Resolve em ordem: cpf > phone > instagram > email > id.
 */
import { useEffect, useState } from 'react';
import { useUnifiedCustomerStore, UnifiedCustomer } from '@/stores/unifiedCustomerStore';

type LookupKey = {
  cpf?: string | null;
  phone?: string | null;
  instagram?: string | null;
  email?: string | null;
  id?: string | null;
};

export function useUnifiedCustomer(key: LookupKey) {
  const { findByCpf, findByPhone, findByInstagram, findByEmail, findById } =
    useUnifiedCustomerStore();
  const [customer, setCustomer] = useState<UnifiedCustomer | null>(null);
  const [loading, setLoading] = useState(false);

  const { cpf, phone, instagram, email, id } = key;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        let result: UnifiedCustomer | null = null;
        if (cpf) result = await findByCpf(cpf);
        if (!result && phone) result = await findByPhone(phone);
        if (!result && instagram) result = await findByInstagram(instagram);
        if (!result && email) result = await findByEmail(email);
        if (!result && id) result = await findById(id);
        if (!cancelled) setCustomer(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (cpf || phone || instagram || email || id) {
      run();
    } else {
      setCustomer(null);
    }
    return () => {
      cancelled = true;
    };
  }, [cpf, phone, instagram, email, id, findByCpf, findByPhone, findByInstagram, findByEmail, findById]);

  return { customer, loading };
}
