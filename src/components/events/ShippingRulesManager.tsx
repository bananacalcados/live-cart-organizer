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

const COMMON_CARRIERS = ['Correios', 'JADLOG', 'LATAM Cargo', 'Azul Cargo', 'Total Express'];

const EMPTY_RULE: Omit<ShippingRule, 'id'> = {
  event_id: null,
  name: '',
  is_active: true,
  rule_type: 'fixed_price',
  carrier_match: null,
  region_states: null,
  cep_range_start: null,
  cep_range_end: null,
  fixed_price: null,
  discount_percentage: null,
  discount_fixed: null,
  priority: 0,
};

interface Props {
  eventId?: string;
}

export function ShippingRulesManager({ eventId }: Props) {
  const [rules, setRules] = useState<ShippingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Partial<ShippingRule> & typeof EMPTY_RULE>(EMPTY_RULE);
  const [selectedRegion, setSelectedRegion] = useState<string>('');

  const fetchRules = async () => {
    setLoading(true);
    let query = supabase.from('shipping_rules').select('*').order('priority', { ascending: false });
    if (eventId) {
      query = query.or(`event_id.eq.${eventId},event_id.is.null`);
    } else {
      query = query.is('event_id', null);
    }
    const { data, error } = await query;
    if (error) {
      toast.error('Erro ao carregar regras de frete');
    } else {
      setRules((data || []) as unknown as ShippingRule[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRules(); }, [eventId]);

  const handleSave = async () => {
    if (!editing.name) { toast.error('Nome é obrigatório'); return; }
    setSaving(true);

    const payload: any = {
      name: editing.name,
      is_active: editing.is_active,
      rule_type: editing.rule_type,
      carrier_match: editing.carrier_match || null,
      region_states: editing.region_states?.length ? editing.region_states : null,
      cep_range_start: editing.cep_range_start || null,
      cep_range_end: editing.cep_range_end || null,
      fixed_price: editing.rule_type === 'fixed_price' ? editing.fixed_price : null,
      discount_percentage: editing.rule_type === 'discount_percentage' ? editing.discount_percentage : null,
      discount_fixed: editing.rule_type === 'discount_fixed' ? editing.discount_fixed : null,
      priority: editing.priority || 0,
      event_id: eventId || null,
    };

    let error;
    if ((editing as any).id) {
      ({ error } = await supabase.from('shipping_rules').update(payload).eq('id', (editing as any).id));
    } else {
      ({ error } = await supabase.from('shipping_rules').insert(payload));
    }

    if (error) {
      toast.error('Erro ao salvar regra');
    } else {
      toast.success('Regra salva!');
      setDialogOpen(false);
      setEditing({ ...EMPTY_RULE });
      fetchRules();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('shipping_rules').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir');
    else { toast.success('Regra excluída'); fetchRules(); }
  };

  const handleToggle = async (id: string, active: boolean) => {
    await supabase.from('shipping_rules').update({ is_active: active }).eq('id', id);
    fetchRules();
  };

  const openEdit = (rule: ShippingRule) => {
    setEditing(rule);
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

  const ruleTypeLabel = (t: string) => {
    if (t === 'fixed_price') return 'Preço fixo';
    if (t === 'discount_percentage') return 'Desconto %';
    if (t === 'discount_fixed') return 'Desconto R$';
    return t;
  };

  const ruleValueLabel = (r: ShippingRule) => {
    if (r.rule_type === 'fixed_price' && r.fixed_price != null) return `R$ ${Number(r.fixed_price).toFixed(2)}`;
    if (r.rule_type === 'discount_percentage' && r.discount_percentage != null) return `-${r.discount_percentage}%`;
    if (r.rule_type === 'discount_fixed' && r.discount_fixed != null) return `-R$ ${Number(r.discount_fixed).toFixed(2)}`;
    return '—';
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5" />
          Regras de Frete {eventId ? '(Evento)' : '(Global)'}
        </CardTitle>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing({ ...EMPTY_RULE }); }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Regra</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{(editing as any).id ? 'Editar Regra' : 'Nova Regra de Frete'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome da regra</Label>
                <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Ex: Frete fixo Correios Sul" />
              </div>

              <div>
                <Label>Tipo de regra</Label>
                <Select value={editing.rule_type} onValueChange={v => setEditing({ ...editing, rule_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_price">Preço fixo</SelectItem>
                    <SelectItem value="discount_percentage">Desconto % sobre Frenet</SelectItem>
                    <SelectItem value="discount_fixed">Desconto R$ fixo sobre Frenet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editing.rule_type === 'fixed_price' && (
                <div>
                  <Label>Valor fixo (R$)</Label>
                  <Input type="number" step="0.01" value={editing.fixed_price ?? ''} onChange={e => setEditing({ ...editing, fixed_price: parseFloat(e.target.value) || 0 })} placeholder="19.99" />
                </div>
              )}
              {editing.rule_type === 'discount_percentage' && (
                <div>
                  <Label>Desconto (%)</Label>
                  <Input type="number" step="1" value={editing.discount_percentage ?? ''} onChange={e => setEditing({ ...editing, discount_percentage: parseFloat(e.target.value) || 0 })} placeholder="30" />
                </div>
              )}
              {editing.rule_type === 'discount_fixed' && (
                <div>
                  <Label>Desconto fixo (R$)</Label>
                  <Input type="number" step="0.01" value={editing.discount_fixed ?? ''} onChange={e => setEditing({ ...editing, discount_fixed: parseFloat(e.target.value) || 0 })} placeholder="5.00" />
                </div>
              )}

              <div>
                <Label>Transportadora (filtro)</Label>
                <Select value={editing.carrier_match || '__all__'} onValueChange={v => setEditing({ ...editing, carrier_match: v === '__all__' ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas as transportadoras</SelectItem>
                    {COMMON_CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Busca parcial no nome (ex: "Correios" casa com "Correios PAC", "Correios SEDEX")</p>
              </div>

              <div>
                <Label>Região / Estados (filtro)</Label>
                <div className="flex gap-2 mb-2">
                  <Select value={selectedRegion} onValueChange={selectRegion}>
                    <SelectTrigger className="w-48"><SelectValue placeholder="Add região..." /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(REGIONS).map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
                <p className="text-xs text-muted-foreground mt-1">Vazio = aplica pra todo o Brasil. Requer que a Frenet retorne o estado destino.</p>
              </div>

              <div>
                <Label>Prioridade</Label>
                <Input type="number" value={editing.priority} onChange={e => setEditing({ ...editing, priority: parseInt(e.target.value) || 0 })} />
                <p className="text-xs text-muted-foreground">Maior = aplicada primeiro. Regras do evento sobrescrevem as globais.</p>
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
            Nenhuma regra configurada. Os fretes serão cotados diretamente pela Frenet.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map(rule => (
              <div key={rule.id} className="flex items-center gap-3 p-3 border rounded-lg">
                <Switch checked={rule.is_active} onCheckedChange={v => handleToggle(rule.id, v)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{rule.name}</span>
                    {rule.event_id ? <Badge variant="secondary" className="text-xs">Evento</Badge> : <Badge variant="outline" className="text-xs">Global</Badge>}
                  </div>
                  <div className="flex gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{ruleTypeLabel(rule.rule_type)}: <strong>{ruleValueLabel(rule)}</strong></span>
                    {rule.carrier_match && <span>• {rule.carrier_match}</span>}
                    {rule.region_states?.length ? <span>• {rule.region_states.join(', ')}</span> : null}
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
