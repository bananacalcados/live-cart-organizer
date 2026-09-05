import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { LeadFieldDefinition } from '@/lib/leadFields';

let cache: LeadFieldDefinition[] | null = null;
const listeners = new Set<(d: LeadFieldDefinition[]) => void>();

export async function fetchLeadFieldDefinitions(force = false): Promise<LeadFieldDefinition[]> {
  if (cache && !force) return cache;
  const { data, error } = await supabase
    .from('lead_field_definitions' as any)
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) throw error;
  cache = ((data || []) as any[]).map((d) => ({ ...d, options: Array.isArray(d.options) ? d.options : [] })) as LeadFieldDefinition[];
  listeners.forEach((l) => l(cache!));
  return cache;
}

export function invalidateLeadFieldDefinitions() {
  cache = null;
}

/** Catálogo global de campos de lead (com cache compartilhado entre componentes). */
export function useLeadFieldDefinitions(opts: { activeOnly?: boolean } = {}) {
  const [fields, setFields] = useState<LeadFieldDefinition[]>(cache || []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setFields(await fetchLeadFieldDefinitions(true));
      setError(null);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const l = (d: LeadFieldDefinition[]) => setFields(d);
    listeners.add(l);
    if (!cache) {
      fetchLeadFieldDefinitions().then(setFields).catch((e) => setError(e.message)).finally(() => setLoading(false));
    }
    return () => { listeners.delete(l); };
  }, []);

  const visible = opts.activeOnly ? fields.filter((f) => f.is_active) : fields;
  const byId = new Map(fields.map((f) => [f.id, f]));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return { fields: visible, allFields: fields, byId, byKey, loading, error, reload };
}
