import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download } from 'lucide-react';
import { useLeadFieldDefinitions } from '@/hooks/useLeadFieldDefinitions';
import { formatLeadValue } from '@/lib/leadFields';

interface Lead {
  id: string;
  name: string;
  phone: string;
  source: string;
  typebot_id: string | null;
  event_id: string | null;
  custom_fields: Record<string, unknown> | null;
  disqualified: boolean;
  disqualify_reason: string | null;
  notify_status: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  created_at: string;
}

/**
 * Lista de leads com uma coluna por campo do catálogo (só os que têm resposta),
 * filtro por coluna e exportação CSV. Leads desqualificados ficam separados.
 */
export function TypebotLeadsTable({ typebotId, eventId, typebotNames }: {
  typebotId?: string | null;
  eventId?: string | null;
  typebotNames?: Record<string, string>;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [view, setView] = useState<'qualified' | 'disqualified'>('qualified');
  const { allFields, byKey } = useLeadFieldDefinitions();

  useEffect(() => {
    (async () => {
      setLoading(true);
      let query = supabase
        .from('event_leads')
        .select('id, name, phone, source, typebot_id, event_id, custom_fields, disqualified, disqualify_reason, notify_status, utm_source, utm_campaign, created_at')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (typebotId) query = query.eq('typebot_id', typebotId);
      else if (eventId) query = query.eq('event_id', eventId);
      else query = query.not('typebot_id', 'is', null);
      const { data } = await query;
      setLeads((data || []) as any);
      setLoading(false);
    })();
  }, [typebotId, eventId]);

  // Colunas = campos do catálogo com pelo menos uma resposta nesta lista (na ordem do catálogo) + chaves fora do catálogo.
  const columns = useMemo(() => {
    const used = new Set<string>();
    leads.forEach((l) => Object.keys(l.custom_fields || {}).forEach((k) => used.add(k)));
    const inCatalog = allFields.filter((f) => used.has(f.key)).map((f) => ({ key: f.key, label: f.label }));
    const extra = [...used].filter((k) => !byKey.has(k)).map((k) => ({ key: k, label: k }));
    return [...inCatalog, ...extra];
  }, [leads, allFields, byKey]);

  const filtered = leads.filter((l) => {
    if (view === 'qualified' ? l.disqualified : !l.disqualified) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!(l.name || '').toLowerCase().includes(s) && !(l.phone || '').includes(s)) return false;
    }
    for (const [k, v] of Object.entries(colFilters)) {
      if (!v) continue;
      const cell = formatLeadValue(byKey.get(k), (l.custom_fields || {})[k]).toLowerCase();
      if (!cell.includes(v.toLowerCase())) return false;
    }
    return true;
  });

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Nome', 'WhatsApp', 'Typebot', 'Status', 'Motivo', ...columns.map((c) => c.label), 'UTM Source', 'UTM Campaign', 'Data'];
    const rows = filtered.map((l) => [
      l.name, l.phone, typebotNames?.[l.typebot_id || ''] || l.typebot_id || '', l.disqualified ? 'Desqualificado' : 'Qualificado', l.disqualify_reason || '',
      ...columns.map((c) => formatLeadValue(byKey.get(c.key), (l.custom_fields || {})[c.key])),
      l.utm_source || '', l.utm_campaign || '', new Date(l.created_at).toLocaleString('pt-BR'),
    ].map(esc).join(','));
    const blob = new Blob(['\uFEFF' + header.map(esc).join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `leads-${typebotId || eventId || 'typebots'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const qualifiedCount = leads.filter((l) => !l.disqualified).length;
  const disqCount = leads.length - qualifiedCount;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button size="sm" variant={view === 'qualified' ? 'default' : 'outline'} onClick={() => setView('qualified')}>
            Qualificados ({qualifiedCount})
          </Button>
          <Button size="sm" variant={view === 'disqualified' ? 'default' : 'outline'} onClick={() => setView('disqualified')}>
            Desqualificados ({disqCount})
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome ou telefone" className="h-8 w-56" />
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Nome</th>
              <th className="p-2">WhatsApp</th>
              {!typebotId && <th className="p-2">Typebot</th>}
              {view === 'disqualified' && <th className="p-2">Motivo</th>}
              {columns.map((c) => <th key={c.key} className="p-2 whitespace-nowrap">{c.label}</th>)}
              <th className="p-2">Aviso PDV</th>
              <th className="p-2">Data</th>
            </tr>
            <tr className="border-b bg-muted/30">
              <th className="p-1" colSpan={2 + (!typebotId ? 1 : 0) + (view === 'disqualified' ? 1 : 0)} />
              {columns.map((c) => (
                <th key={c.key} className="p-1">
                  <Input
                    value={colFilters[c.key] || ''}
                    onChange={(e) => setColFilters({ ...colFilters, [c.key]: e.target.value })}
                    placeholder="filtrar"
                    className="h-6 text-[11px] min-w-[80px]"
                  />
                </th>
              ))}
              <th className="p-1" colSpan={2} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} className="border-b hover:bg-muted/20">
                <td className="p-2 font-medium whitespace-nowrap">{l.name}</td>
                <td className="p-2 font-mono whitespace-nowrap">{l.phone}</td>
                {!typebotId && <td className="p-2 whitespace-nowrap">{typebotNames?.[l.typebot_id || ''] || '—'}</td>}
                {view === 'disqualified' && <td className="p-2">{l.disqualify_reason || '—'}</td>}
                {columns.map((c) => (
                  <td key={c.key} className="p-2 whitespace-nowrap">{formatLeadValue(byKey.get(c.key), (l.custom_fields || {})[c.key]) || '—'}</td>
                ))}
                <td className="p-2">
                  {l.notify_status === 'sent' && <Badge className="text-[10px]">enviado</Badge>}
                  {l.notify_status === 'queued' && <Badge variant="secondary" className="text-[10px]">agendado</Badge>}
                  {l.notify_status === 'blocked' && <Badge variant="outline" className="text-[10px]">bloqueado</Badge>}
                  {l.notify_status === 'failed' && <Badge variant="destructive" className="text-[10px]">falhou</Badge>}
                  {!l.notify_status && '—'}
                </td>
                <td className="p-2 whitespace-nowrap">{new Date(l.created_at).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={20} className="p-6 text-center text-muted-foreground">Nenhum lead</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
