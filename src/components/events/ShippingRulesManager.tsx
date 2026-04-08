import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Truck, Save, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface ShippingRule {
  id: string;
  event_id: string | null;
  name: string;
  is_active: boolean;
  rule_type: string;
  carrier_match: string | null;
  region_states: string[] | null;
  cep_range_start: string | null;
  cep_range_end: string | null;
  fixed_price: number | null;
  discount_percentage: number | null;
  discount_fixed: number | null;
  priority: number;
}

const BRAZILIAN_STATES = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
];

const REGIONS: Record<string, string[]> = {
  'Sudeste': ['SP','RJ','MG','ES'],
  'Sul': ['PR','SC','RS'],
  'Nordeste': ['BA','CE','MA','PB','PE','PI','RN','SE','AL'],
  'Norte': ['AC','AM','AP','PA','RO','RR','TO'],
  'Centro-Oeste': ['DF','GO','MS','MT'],
};

interface EditingRule {
  id?: string;
  name: string;
  is_active: boolean;
  fixed_price: number | null;
  region_states: string[] | null;
  priority: number;
}

const EMPTY_RULE: EditingRule = {
  name: '',
  is_active: true,
  fixed_price: null,
  region_states: null,
  priority: 0,
};

interface Props {
  eventId?: string;
  storeId?: string;
}

export function ShippingRulesManager({ eventId, storeId }: Props) {
  const [rules, setRules] = useState<ShippingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EditingRule>({ ...EMPTY_RULE });
  const [selectedRegion, setSelectedRegion] = useState<string>('');

  const fetchRules = async () => {
    setLoading(true);
    let query = supabase.from('shipping_rules').select('*').order('priority', { ascending: false });
    if (eventId) {
      query = query.eq('event_id', eventId);
    } else if (storeId) {
      query = query.eq('store_id', storeId);
    } else {
      query = query.is('event_id', null).is('store_id', null);
    }
    const { data, error } = await query;
    if (error) {
      toast.error('Erro ao carregar opções de frete');
    } else {
      setRules((data || []) as unknown as ShippingRule[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRules(); }, [eventId, storeId]);

  const handleSave = async () => {
    if (!editing.name) { toast.error('Nome é obrigatório'); return; }
    if (editing.fixed_price == null || editing.fixed_price < 0) { toast.error('Valor do frete é obrigatório'); return; }
    setSaving(true);

    const payload: any = {
      name: editing.name,
      is_active: editing.is_active,
      rule_type: 'fixed_price',
      carrier_match: null,
      region_states: editing.region_states?.length ? editing.region_states : null,
      cep_range_start: null,
      cep_range_end: null,
      fixed_price: editing.fixed_price,
      discount_percentage: null,
      discount_fixed: null,
      priority: editing.priority || 0,
      event_id: eventId || null,
      store_id: storeId || null,
    };

    let error;
    if (editing.id) {
      ({ error } = await supabase.from('shipping_rules').update(payload).eq('id', editing.id));
    } else {
      ({ error } = await supabase.from('shipping_rules').insert(payload));
    }

    if (error) {
      toast.error('Erro ao salvar');
    } else {
      toast.success('Opção de frete salva!');
      setDialogOpen(false);
      setEditing({ ...EMPTY_RULE });
      fetchRules();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('shipping_rules').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir');
    else { toast.success('Opção excluída'); fetchRules(); }
  };

  const handleToggle = async (id: string, active: boolean) => {
    await supabase.from('shipping_rules').update({ is_active: active }).eq('id', id);
    fetchRules();
  };

  const openEdit = (rule: ShippingRule) => {
    setEditing({
      id: rule.id,
      name: rule.name,
      is_active: rule.is_active,
      fixed_price: rule.fixed_price,
      region_states: rule.region_states,
      priority: rule.priority,
    });
    setDialogOpen(true);
  };

  const toggleState = (state: string) => {
    const current = editing.region_states || [];
    setEditing({
      ...editing,
      region_states: current.includes(state) ? current.filter(s => s !== state) : [...current, state],
    });
  };

  const selectRegion = (region: string) => {
    const states = REGIONS[region] || [];
    setEditing({ ...editing, region_states: [...new Set([...(editing.region_states || []), ...states])] });
    setSelectedRegion('');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5" />
          Opções de Frete {eventId ? 'da Live' : '(Global)'}
        </CardTitle>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing({ ...EMPTY_RULE }); }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Opção</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing.id ? 'Editar Opção de Frete' : 'Nova Opção de Frete'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Ex: Frete Padrão, Frete Sudeste, Frete Sul..." />
              </div>

              <div>
                <Label>Valor do frete (R$)</Label>
                <Input type="number" step="0.01" min="0" value={editing.fixed_price ?? ''} onChange={e => setEditing({ ...editing, fixed_price: parseFloat(e.target.value) || 0 })} placeholder="19.99" />
                <p className="text-xs text-muted-foreground mt-1">Use 0 para frete grátis</p>
              </div>

              <div>
                <Label>Região / Estados</Label>
                <div className="flex gap-2 mb-2">
                  <Select value={selectedRegion} onValueChange={selectRegion}>
                    <SelectTrigger className="w-48"><SelectValue placeholder="Selecionar região..." /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(REGIONS).map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {(editing.region_states?.length ?? 0) > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing({ ...editing, region_states: null })}>Limpar</Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {BRAZILIAN_STATES.map(s => (
                    <Badge
                      key={s}
                      variant={(editing.region_states || []).includes(s) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => toggleState(s)}
                    >
                      {s}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Vazio = aplica pra todo o Brasil</p>
              </div>

              <div>
                <Label>Prioridade</Label>
                <Input type="number" value={editing.priority} onChange={e => setEditing({ ...editing, priority: parseInt(e.target.value) || 0 })} />
                <p className="text-xs text-muted-foreground">Maior = aparece primeiro no checkout</p>
              </div>

              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Salvar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-6 text-muted-foreground">Carregando...</div>
        ) : rules.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            Nenhuma opção de frete configurada. O checkout mostrará apenas as cotações da Frenet + retirada na loja.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map(rule => (
              <div key={rule.id} className="flex items-center gap-3 p-3 border rounded-lg">
                <Switch checked={rule.is_active} onCheckedChange={v => handleToggle(rule.id, v)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{rule.name}</span>
                    {rule.event_id ? <Badge variant="secondary" className="text-xs">Live</Badge> : <Badge variant="outline" className="text-xs">Global</Badge>}
                  </div>
                  <div className="flex gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>R$ {Number(rule.fixed_price || 0).toFixed(2)}</span>
                    {rule.region_states?.length ? <span>• {rule.region_states.join(', ')}</span> : <span>• Todo Brasil</span>}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>Editar</Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(rule.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
