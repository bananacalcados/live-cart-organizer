import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ArrowUp, ArrowDown, Copy, ExternalLink, Pencil, Loader2, MessageCircle, FastForward, CheckCircle2 } from 'lucide-react';
import {
  SimStop,
  SimulationRecord,
  currentStatusLabel,
  estimatedDelivery,
  generateTrackingCode,
} from '@/lib/shipmentSimulation';

type Row = SimulationRecord & {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  order_reference: string | null;
  created_at: string;
};

const emptyForm = () => ({
  id: '' as string,
  tracking_code: generateTrackingCode(),
  customer_name: '',
  customer_phone: '',
  order_reference: '',
  origin_city: '',
  origin_state: '',
  destination_city: '',
  destination_state: '',
  stops: [] as SimStop[],
  posted_at: new Date().toISOString().slice(0, 16),
  step_interval_days: 2,
  manual_offset_days: 0,
  status: 'active',
});

const publicUrl = (code: string) => `${window.location.origin}/rastreio/${code}`;

export function ShipmentSimulations() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('shipment_simulations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error('Erro ao carregar simulações');
    setRows(((data ?? []) as unknown as Row[]).map((r) => ({ ...r, stops: (r.stops as unknown as SimStop[]) ?? [] })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.tracking_code, r.customer_name, r.customer_phone, r.destination_city].some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const openNew = () => { setForm(emptyForm()); setOpen(true); };

  const openEdit = (r: Row) => {
    setForm({
      id: r.id,
      tracking_code: r.tracking_code,
      customer_name: r.customer_name ?? '',
      customer_phone: r.customer_phone ?? '',
      order_reference: r.order_reference ?? '',
      origin_city: r.origin_city,
      origin_state: r.origin_state,
      destination_city: r.destination_city,
      destination_state: r.destination_state,
      stops: r.stops ?? [],
      posted_at: new Date(r.posted_at).toISOString().slice(0, 16),
      step_interval_days: r.step_interval_days,
      manual_offset_days: r.manual_offset_days,
      status: r.status,
    });
    setOpen(true);
  };

  const duplicate = (r: Row) => {
    setForm({
      ...emptyForm(),
      tracking_code: generateTrackingCode(),
      origin_city: r.origin_city,
      origin_state: r.origin_state,
      destination_city: r.destination_city,
      destination_state: r.destination_state,
      stops: [...(r.stops ?? [])],
      step_interval_days: r.step_interval_days,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.origin_city || !form.origin_state || !form.destination_city || !form.destination_state) {
      toast.error('Preencha origem e destino');
      return;
    }
    setSaving(true);
    const payload = {
      tracking_code: form.tracking_code.trim().toUpperCase(),
      customer_name: form.customer_name || null,
      customer_phone: form.customer_phone || null,
      order_reference: form.order_reference || null,
      origin_city: form.origin_city.trim(),
      origin_state: form.origin_state.trim().toUpperCase(),
      destination_city: form.destination_city.trim(),
      destination_state: form.destination_state.trim().toUpperCase(),
      stops: form.stops.filter((s) => s.city && s.state).map((s) => ({ city: s.city.trim(), state: s.state.trim().toUpperCase() })),
      posted_at: new Date(form.posted_at).toISOString(),
      step_interval_days: Number(form.step_interval_days) || 2,
      manual_offset_days: Number(form.manual_offset_days) || 0,
      status: form.status,
    };
    const res = form.id
      ? await supabase.from('shipment_simulations').update(payload).eq('id', form.id)
      : await supabase.from('shipment_simulations').insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(form.id ? 'Simulação atualizada' : 'Simulação criada');
    setOpen(false);
    load();
  };

  const remove = async (r: Row) => {
    if (!confirm(`Excluir a simulação ${r.tracking_code}?`)) return;
    const { error } = await supabase.from('shipment_simulations').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Excluída');
    load();
  };

  const patch = async (r: Row, values: Record<string, unknown>) => {
    const { error } = await supabase.from('shipment_simulations').update(values).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const advance = (r: Row) => patch(r, { manual_offset_days: (r.manual_offset_days || 0) + (r.step_interval_days || 2) });

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(publicUrl(code));
    toast.success('Link copiado');
  };

  const sendWhats = (r: Row) => {
    const phone = (r.customer_phone ?? '').replace(/\D/g, '');
    const msg = encodeURIComponent(`Seu pedido foi postado! Acompanhe o rastreio: ${publicUrl(r.tracking_code)}`);
    window.open(phone ? `https://wa.me/${phone.startsWith('55') ? phone : '55' + phone}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank');
  };

  const addStop = () => setForm((f) => ({ ...f, stops: [...f.stops, { city: '', state: '' }] }));
  const setStop = (i: number, v: Partial<SimStop>) =>
    setForm((f) => ({ ...f, stops: f.stops.map((s, idx) => (idx === i ? { ...s, ...v } : s)) }));
  const removeStop = (i: number) => setForm((f) => ({ ...f, stops: f.stops.filter((_, idx) => idx !== i) }));
  const moveStop = (i: number, dir: -1 | 1) =>
    setForm((f) => {
      const arr = [...f.stops];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return f;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...f, stops: arr };
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar por código, cliente ou destino..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button onClick={openNew} className="gap-2 ml-auto">
          <Plus className="h-4 w-4" /> Nova simulação
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nenhuma simulação criada.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex flex-wrap gap-3 items-start">
                <div className="min-w-[200px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold">{r.tracking_code}</span>
                    <Badge variant={r.status === 'active' ? 'default' : r.status === 'delivered' ? 'secondary' : 'outline'}>
                      {r.status === 'active' ? 'Ativa' : r.status === 'paused' ? 'Pausada' : 'Entregue'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {r.customer_name || 'Sem cliente'} {r.order_reference ? `• ${r.order_reference}` : ''}
                  </p>
                  <p className="text-sm mt-1">
                    {r.origin_city}/{r.origin_state} → {r.destination_city}/{r.destination_state}
                    {r.stops?.length ? ` (${r.stops.length} paradas)` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Etapa atual: <strong>{currentStatusLabel(r)}</strong> • Entrega prevista:{' '}
                    {new Date(estimatedDelivery(r)).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => window.open(publicUrl(r.tracking_code), '_blank')} className="gap-1">
                    <ExternalLink className="h-3.5 w-3.5" /> Ver
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => copyLink(r.tracking_code)} className="gap-1">
                    <Copy className="h-3.5 w-3.5" /> Link
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sendWhats(r)} className="gap-1">
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => advance(r)} className="gap-1">
                    <FastForward className="h-3.5 w-3.5" /> Avançar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => patch(r, { status: 'delivered' })} className="gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Entregue
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => duplicate(r)} className="gap-1">
                    <Copy className="h-3.5 w-3.5" /> Duplicar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? 'Editar simulação' : 'Nova simulação'}</DialogTitle></DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Código de rastreio</Label>
                <Input value={form.tracking_code} onChange={(e) => setForm({ ...form, tracking_code: e.target.value })} className="font-mono" />
              </div>
              <div>
                <Label>Situação</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativa</SelectItem>
                    <SelectItem value="paused">Pausada</SelectItem>
                    <SelectItem value="delivered">Entregue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>Cliente (interno)</Label>
                <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div>
                <Label>WhatsApp</Label>
                <Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} />
              </div>
            </div>

            <div>
              <Label>Pedido (opcional)</Label>
              <Input value={form.order_reference} onChange={(e) => setForm({ ...form, order_reference: e.target.value })} placeholder="Nº do pedido" />
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-3">
                <Label>Cidade de saída</Label>
                <Input value={form.origin_city} onChange={(e) => setForm({ ...form, origin_city: e.target.value })} />
              </div>
              <div>
                <Label>UF</Label>
                <Input maxLength={2} value={form.origin_state} onChange={(e) => setForm({ ...form, origin_state: e.target.value })} />
              </div>
              <div className="col-span-3">
                <Label>Cidade destino</Label>
                <Input value={form.destination_city} onChange={(e) => setForm({ ...form, destination_city: e.target.value })} />
              </div>
              <div>
                <Label>UF</Label>
                <Input maxLength={2} value={form.destination_state} onChange={(e) => setForm({ ...form, destination_state: e.target.value })} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Cidades por onde vai passar</Label>
                <Button size="sm" variant="outline" onClick={addStop} className="gap-1"><Plus className="h-3.5 w-3.5" /> Adicionar cidade</Button>
              </div>
              <div className="space-y-2">
                {form.stops.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma cidade intermediária.</p>}
                {form.stops.map((s, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input placeholder="Cidade" value={s.city} onChange={(e) => setStop(i, { city: e.target.value })} />
                    <Input placeholder="UF" maxLength={2} className="w-20" value={s.state} onChange={(e) => setStop(i, { state: e.target.value })} />
                    <Button size="icon" variant="ghost" onClick={() => moveStop(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => moveStop(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => removeStop(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data/hora da postagem</Label>
                <Input type="datetime-local" value={form.posted_at} onChange={(e) => setForm({ ...form, posted_at: e.target.value })} />
              </div>
              <div>
                <Label>Dias entre etapas</Label>
                <Input type="number" min={1} value={form.step_interval_days} onChange={(e) => setForm({ ...form, step_interval_days: Number(e.target.value) })} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
