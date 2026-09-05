import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Save, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import { useLeadFieldDefinitions } from '@/hooks/useLeadFieldDefinitions';
import {
  LEAD_FIELD_TYPE_LABELS, slugifyKey, isChoiceType,
  type LeadFieldDefinition, type LeadFieldType, type LeadFieldOption,
} from '@/lib/leadFields';

const TYPES = Object.keys(LEAD_FIELD_TYPE_LABELS) as LeadFieldType[];

/** Eventos > Typebots > Campos — catálogo global de campos padronizados de lead. */
export function LeadFieldsCatalogPanel() {
  const { allFields, loading, reload } = useLeadFieldDefinitions();
  const [editing, setEditing] = useState<LeadFieldDefinition | null>(null);
  const [saving, setSaving] = useState(false);

  function startNew() {
    setEditing({
      id: '', key: '', label: '', field_type: 'text', options: [], required: false,
      is_active: true, sort_order: (allFields.at(-1)?.sort_order ?? 0) + 10, description: '',
    });
  }

  async function save() {
    if (!editing) return;
    if (!editing.label.trim()) { toast.error('Informe o nome do campo'); return; }
    const key = editing.key || slugifyKey(editing.label);
    if (!/^[a-z][a-z0-9_]{1,59}$/.test(key)) { toast.error('Chave inválida: use letras minúsculas, números e _'); return; }
    if (isChoiceType(editing.field_type) && editing.field_type !== 'yes_no') {
      const opts = editing.options.filter((o) => o.label.trim());
      if (opts.length < 2) { toast.error('Listas fixas precisam de pelo menos 2 opções'); return; }
    }
    setSaving(true);
    const payload: any = {
      key, label: editing.label.trim(), field_type: editing.field_type,
      options: editing.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), value: (o.value || slugifyKey(o.label)).trim() })),
      required: editing.required, is_active: editing.is_active, sort_order: editing.sort_order,
      description: editing.description || null,
    };
    const q = editing.id
      ? supabase.from('lead_field_definitions' as any).update(payload).eq('id', editing.id)
      : supabase.from('lead_field_definitions' as any).insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) { toast.error(error.message.includes('duplicate') ? 'Já existe um campo com essa chave' : error.message); return; }
    toast.success('Campo salvo');
    setEditing(null);
    reload();
  }

  async function remove(f: LeadFieldDefinition) {
    // Campos com respostas gravadas não são apagados — apenas desativados.
    const { count } = await supabase
      .from('event_leads')
      .select('id', { count: 'exact', head: true })
      .contains('custom_fields', { [f.key]: null } as any);
    void count;
    const { data: used } = await supabase
      .from('event_leads')
      .select('id')
      .not('custom_fields', 'is', null)
      .filter('custom_fields', 'cs', JSON.stringify({}))
      .limit(0);
    void used;
    if (!confirm(`Excluir o campo "${f.label}"? Se já houver respostas gravadas, ele será apenas desativado.`)) return;
    const { data: any } = await supabase.rpc('lead_field_has_answers' as any, { p_key: f.key }).then((r: any) => r, () => ({ data: null }));
    const hasAnswers = any === true;
    if (hasAnswers || f.is_system) {
      const { error } = await supabase.from('lead_field_definitions' as any).update({ is_active: false }).eq('id', f.id);
      if (error) toast.error(error.message); else toast.success('Campo desativado (já possui respostas)');
    } else {
      const { error } = await supabase.from('lead_field_definitions' as any).delete().eq('id', f.id);
      if (error) toast.error(error.message); else toast.success('Campo excluído');
    }
    reload();
  }

  async function move(f: LeadFieldDefinition, dir: -1 | 1) {
    const sorted = [...allFields].sort((a, b) => a.sort_order - b.sort_order);
    const i = sorted.findIndex((x) => x.id === f.id);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const a = sorted[i], b = sorted[j];
    await Promise.all([
      supabase.from('lead_field_definitions' as any).update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('lead_field_definitions' as any).update({ sort_order: a.sort_order }).eq('id', b.id),
    ]);
    reload();
  }

  if (loading) return <div className="p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/30">
        <h3 className="font-bold">Campos padronizados de lead</h3>
        <p className="text-sm text-muted-foreground">
          Crie aqui os campos uma única vez (CPF, renda, tamanho...). Todo typebot escolhe perguntas a partir desta lista,
          então a mesma informação sempre cai na mesma coluna da ficha do lead — sem duplicar.
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        <div className="space-y-2">
          <Button onClick={startNew}><Plus className="h-4 w-4 mr-2" /> Novo campo</Button>
          {[...allFields].sort((a, b) => a.sort_order - b.sort_order).map((f) => (
            <Card key={f.id} className={`p-3 flex items-center gap-3 ${!f.is_active ? 'opacity-50' : ''} ${editing?.id === f.id ? 'border-primary' : ''}`}>
              <div className="flex flex-col">
                <button className="text-muted-foreground hover:text-foreground" onClick={() => move(f, -1)}><ArrowUp className="h-3 w-3" /></button>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => move(f, 1)}><ArrowDown className="h-3 w-3" /></button>
              </div>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditing({ ...f })}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{f.label}</span>
                  <code className="text-[10px] bg-muted px-1 rounded">{f.key}</code>
                  <Badge variant="outline" className="text-[10px]">{LEAD_FIELD_TYPE_LABELS[f.field_type]}</Badge>
                  {f.required && <Badge variant="secondary" className="text-[10px]">obrigatório</Badge>}
                  {!f.is_active && <Badge variant="destructive" className="text-[10px]">inativo</Badge>}
                </div>
                {isChoiceType(f.field_type) && f.field_type !== 'yes_no' && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {f.options.map((o) => o.label).join(' · ')}
                  </div>
                )}
              </div>
              <Button size="icon" variant="ghost" title="Excluir / desativar" onClick={() => remove(f)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </Card>
          ))}
        </div>

        {editing && (
          <Card className="p-4 space-y-3 h-fit sticky top-4">
            <h4 className="font-bold">{editing.id ? 'Editar campo' : 'Novo campo'}</h4>
            <div>
              <Label className="text-xs">Nome exibido</Label>
              <Input
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value, key: editing.id ? editing.key : slugifyKey(e.target.value) })}
                placeholder="Ex: Tamanho que calça"
              />
            </div>
            <div>
              <Label className="text-xs">Chave interna {editing.id && <span className="text-muted-foreground">(não pode mudar)</span>}</Label>
              <Input
                value={editing.key}
                disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, key: slugifyKey(e.target.value) })}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <select
                value={editing.field_type}
                disabled={!!editing.id && editing.is_system}
                onChange={(e) => setEditing({ ...editing, field_type: e.target.value as LeadFieldType })}
                className="w-full text-sm bg-background border rounded px-2 py-2"
              >
                {TYPES.map((t) => <option key={t} value={t}>{LEAD_FIELD_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            {(editing.field_type === 'select' || editing.field_type === 'multiselect') && (
              <OptionsEditor options={editing.options} onChange={(options) => setEditing({ ...editing, options })} />
            )}
            <div>
              <Label className="text-xs">Descrição (ajuda interna)</Label>
              <Input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={editing.required} onCheckedChange={(v) => setEditing({ ...editing, required: v })} />
                <Label className="text-xs">Obrigatório por padrão</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
                <Label className="text-xs">Ativo</Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" /> Salvar</>}
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: LeadFieldOption[]; onChange: (o: LeadFieldOption[]) => void }) {
  const [bulk, setBulk] = useState('');
  return (
    <div>
      <Label className="text-xs">Opções (valor padronizado ao lado)</Label>
      <div className="space-y-1 mt-1">
        {options.map((o, i) => (
          <div key={i} className="flex gap-1">
            <Input
              value={o.label}
              placeholder="Texto exibido"
              onChange={(e) => {
                const next = [...options];
                next[i] = { label: e.target.value, value: o.value || slugifyKey(e.target.value) };
                onChange(next);
              }}
            />
            <Input
              value={o.value}
              className="w-28 font-mono text-xs"
              onChange={(e) => { const next = [...options]; next[i] = { ...o, value: e.target.value }; onChange(next); }}
            />
            <Button size="icon" variant="ghost" onClick={() => onChange(options.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
          </div>
        ))}
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => onChange([...options, { label: '', value: '' }])}><Plus className="h-3 w-3 mr-1" /> opção</Button>
        </div>
        <div className="flex gap-1 pt-1">
          <Input value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="Adicionar várias: 33, 34, 35..." className="text-xs" />
          <Button size="sm" variant="secondary" onClick={() => {
            const items = bulk.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
            if (!items.length) return;
            onChange([...options, ...items.map((s) => ({ label: s, value: slugifyKey(s) }))]);
            setBulk('');
          }}>Adicionar</Button>
        </div>
      </div>
    </div>
  );
}

export default LeadFieldsCatalogPanel;
