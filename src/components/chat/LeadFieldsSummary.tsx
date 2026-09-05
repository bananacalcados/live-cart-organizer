import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import { useLeadFieldDefinitions } from '@/hooks/useLeadFieldDefinitions';
import { formatLeadValue } from '@/lib/leadFields';

interface LeadRow {
  id: string;
  name: string;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
  typebot_id: string | null;
  disqualified: boolean;
}

/**
 * Resumo dos campos padronizados captados no Typebot (CPF, renda, cidade, tamanho...)
 * para o telefone da conversa. Casa por DDD + 8 últimos dígitos.
 */
export function LeadFieldsSummary({ phone }: { phone: string }) {
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [tbName, setTbName] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const { allFields, byKey } = useLeadFieldDefinitions();

  useEffect(() => {
    let alive = true;
    (async () => {
      const digits = (phone || '').replace(/\D/g, '');
      if (digits.length < 10) { setLead(null); return; }
      const last8 = digits.slice(-8);
      const ddd = digits.length >= 12 ? digits.slice(2, 4) : digits.slice(0, 2);
      const { data } = await supabase
        .from('event_leads')
        .select('id, name, custom_fields, created_at, typebot_id, disqualified, phone')
        .like('phone', `%${last8}`)
        .not('custom_fields', 'eq', '{}')
        .order('created_at', { ascending: false })
        .limit(10);
      if (!alive) return;
      const match = ((data || []) as any[]).find((l) => {
        const d = String(l.phone || '').replace(/\D/g, '');
        const lddd = d.length >= 12 ? d.slice(2, 4) : d.slice(0, 2);
        return lddd === ddd && l.custom_fields && Object.keys(l.custom_fields).length > 0;
      }) || null;
      setLead(match);
      if (match?.typebot_id) {
        const { data: tb } = await supabase.from('event_typebots').select('name').eq('id', match.typebot_id).maybeSingle();
        if (alive) setTbName((tb as any)?.name || null);
      } else setTbName(null);
    })();
    return () => { alive = false; };
  }, [phone]);

  if (!lead) return null;
  const cf = lead.custom_fields || {};
  const rows = [
    ...allFields.filter((f) => cf[f.key] !== undefined && cf[f.key] !== null && cf[f.key] !== '').map((f) => ({ key: f.key, label: f.label, value: formatLeadValue(f, cf[f.key]) })),
    ...Object.keys(cf).filter((k) => !byKey.has(k) && cf[k] !== null && cf[k] !== '').map((k) => ({ key: k, label: k, value: formatLeadValue(undefined, cf[k]) })),
  ];
  if (rows.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b bg-amber-50/70 dark:bg-amber-950/20 flex-shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-xs">
        <ClipboardList className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
        <span className="font-semibold text-amber-900 dark:text-amber-200">Lead Crediário</span>
        {tbName && <Badge variant="outline" className="text-[10px]">{tbName}</Badge>}
        {lead.disqualified && <Badge variant="destructive" className="text-[10px]">desqualificado</Badge>}
        <span className="text-muted-foreground ml-auto">{new Date(lead.created_at).toLocaleDateString('pt-BR')}</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
          {rows.map((r) => (
            <div key={r.key} className="min-w-0">
              <span className="text-muted-foreground">{r.label}: </span>
              <span className="font-medium break-words">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LeadFieldsSummary;
