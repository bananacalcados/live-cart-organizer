import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { problems, type Health } from '../../../supabase/functions/_shared/queue-alarm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';

/** Faixa vermelha (admin) + número do alarme. Uma leitura ao abrir e no botão; sem repetição automática. */
export function QueueAlarmBox() {
  const { isAdmin, ready } = useIsAdmin();
  const [found, setFound] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const [h, s] = await Promise.all([
      supabase.rpc('queue_health', {}),
      supabase.from('queue_alert_settings').select('alert_phone').eq('id', true).maybeSingle(),
    ]);
    if (!h.error && h.data) setFound(problems(h.data as unknown as Health, Date.now()));
    if (!s.error) setPhone(s.data?.alert_phone || '');
  }, []);
  useEffect(() => { if (ready && isAdmin) load(); }, [ready, isAdmin, load]);
  if (!ready || !isAdmin) return null;
  const save = async () => {
    let p = phone.replace(/\D/g, '');
    if (p && (p.length === 10 || p.length === 11)) p = '55' + p;
    if (p && !/^55[1-9]\d{9,10}$/.test(p)) { toast.error('Número inválido: use DDD + número'); return; }
    setSaving(true);
    const { error } = await supabase.from('queue_alert_settings').update({ alert_phone: p || null, updated_at: new Date().toISOString() }).eq('id', true);
    setSaving(false);
    if (error) toast.error('Não foi possível salvar o número'); else { setPhone(p); toast.success(p ? 'Número do alarme salvo' : 'Alarme por WhatsApp desligado'); }
  };
  return <div className="space-y-3">
    {found.length > 0 && <div role="alert" className="flex flex-wrap items-start gap-3 border border-destructive bg-destructive text-destructive-foreground p-3">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <div className="flex-1 min-w-0"><p className="font-semibold">Fila de mensagens parada</p>{found.map(f => <p key={f} className="text-sm break-words">{f}</p>)}</div>
      <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Conferir de novo</Button>
    </div>}
    <div className="flex flex-wrap items-end gap-3 border p-3">
      <div className="space-y-1 min-w-0 flex-1"><Label htmlFor="queue-alarm-phone">Avisar este número quando a fila parar</Label>
        <Input id="queue-alarm-phone" inputMode="tel" placeholder="DDD + número" value={phone} onChange={e => setPhone(e.target.value)} /></div>
      <Button variant="outline" onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4" />Salvar número</Button>
      {found.length === 0 && <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Conferir filas</Button>}
    </div>
  </div>;
}
