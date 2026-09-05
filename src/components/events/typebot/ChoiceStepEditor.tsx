import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2 } from 'lucide-react';

export const FIELD_KEY_SUGGESTIONS = [
  'tamanho_calcado', 'numeracao', 'cor_preferida', 'cidade', 'estado',
  'compra_online', 'faixa_etaria', 'genero', 'ja_e_cliente',
];

export function ChoiceStepEditor({
  step,
  isSingle,
  onChange,
  hideCondition = false,
}: {
  step: any;
  isSingle: boolean;
  onChange: (patch: any) => void;
  /** Oculta a condição antiga (quando o editor novo de regras cuida dos caminhos). */
  hideCondition?: boolean;
}) {
  const options: { label: string; value: string }[] = step.options || [];
  const condition = step.condition || null;

  function updateOption(i: number, patch: any) {
    const next = [...options];
    next[i] = { ...next[i], ...patch };
    onChange({ options: next });
  }
  function addOption() {
    onChange({ options: [...options, { label: '', value: '' }] });
  }
  function removeOption(i: number) {
    const next = options.filter((_, j) => j !== i);
    const nextCond = condition
      ? { ...condition, allowed_values: (condition.allowed_values || []).filter((v: string) => v !== options[i]?.value) }
      : null;
    onChange({ options: next, condition: nextCond });
  }
  function toggleAllowed(value: string) {
    const current: string[] = condition?.allowed_values || [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ condition: { ...(condition || { on_fail: 'end_flow' }), allowed_values: next } });
  }

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Chave do campo (field_key)</Label>
          <Input
            list="tb-field-key-suggestions"
            value={step.field_key || ''}
            onChange={(e) => onChange({ field_key: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })}
            placeholder="ex: tamanho_calcado"
          />
          <datalist id="tb-field-key-suggestions">
            {FIELD_KEY_SUGGESTIONS.map((k) => <option key={k} value={k} />)}
          </datalist>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={!!step.required}
              onCheckedChange={(v) => onChange({ required: v })}
            />
            <Label className="text-xs">Obrigatória</Label>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs">Opções de resposta</Label>
        <div className="space-y-1 mt-1">
          {options.map((opt, i) => (
            <div key={i} className="flex gap-1 items-center">
              <Input
                className="flex-1"
                value={opt.label}
                onChange={(e) => {
                  const label = e.target.value;
                  updateOption(i, { label, value: opt.value || label.trim().toLowerCase().replace(/\s+/g, '_') });
                }}
                placeholder="Texto exibido (ex: 36)"
              />
              <Input
                className="w-32 font-mono text-xs"
                value={opt.value}
                onChange={(e) => updateOption(i, { value: e.target.value })}
                placeholder="valor salvo"
              />
              <Button size="icon" variant="ghost" onClick={() => removeOption(i)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={addOption}>
            <Plus className="h-3 w-3 mr-1" /> opção
          </Button>
        </div>
      </div>

      {!hideCondition && isSingle && options.length > 0 && (
        <div className="border rounded p-2 bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <Switch
              checked={!!condition}
              onCheckedChange={(v) =>
                onChange({
                  condition: v
                    ? { allowed_values: [], on_fail: 'end_flow', fail_message: 'Obrigada pelo interesse!', save_lead_when_disqualified: false }
                    : null,
                })
              }
            />
            <Label className="text-xs font-semibold">Condição para continuar</Label>
          </div>
          {condition && (
            <div className="space-y-2 text-xs">
              <div>
                <div className="text-muted-foreground mb-1">Continuar apenas se a resposta for:</div>
                <div className="flex flex-wrap gap-1">
                  {options.map((opt) => {
                    const active = (condition.allowed_values || []).includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleAllowed(opt.value)}
                        className={`px-2 py-1 rounded border ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted'}`}
                      >
                        {opt.label || opt.value}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="text-xs">Mensagem final quando não continuar</Label>
                <Textarea
                  value={condition.fail_message || ''}
                  onChange={(e) => onChange({ condition: { ...condition, fail_message: e.target.value } })}
                  rows={2}
                  placeholder="Ex: Obrigada! Essa promoção é só para clientes de Valadares."
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!condition.save_lead_when_disqualified}
                  onCheckedChange={(v) => onChange({ condition: { ...condition, save_lead_when_disqualified: v } })}
                />
                <Label className="text-xs">Gravar lead mesmo assim (marcado como desqualificado)</Label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
