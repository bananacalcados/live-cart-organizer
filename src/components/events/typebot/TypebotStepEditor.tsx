import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, ArrowUp, ArrowDown, GitBranch, CornerDownRight } from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { ChoiceStepEditor } from '@/components/events/typebot/ChoiceStepEditor';
import { useLeadFieldDefinitions } from '@/hooks/useLeadFieldDefinitions';
import {
  LEAD_FIELD_TYPE_LABELS, RULE_OPERATOR_LABELS, operatorsForType, optionsForField, isChoiceType,
  legacyConditionToRules, type StepRule, type LeadFieldType, type LeadFieldDefinition,
} from '@/lib/leadFields';

export interface TypebotStep {
  id: string;
  type: 'message' | 'ask_name' | 'ask_phone' | 'ask_field' | 'ask_choice' | 'ask_multichoice' | 'final';
  text: string;
  placeholder?: string;
  field_id?: string;
  field_key?: string;
  options?: { label: string; value: string }[];
  required?: boolean;
  rules?: StepRule[];
  condition?: any;
  [k: string]: any;
}

export const STEP_TYPE_LABELS: Record<TypebotStep['type'], string> = {
  message: 'Mensagem',
  ask_name: 'Pergunta: Nome',
  ask_phone: 'Pergunta: WhatsApp',
  ask_field: 'Pergunta: Campo do catálogo',
  ask_choice: 'Pergunta: Escolha única (livre)',
  ask_multichoice: 'Pergunta: Múltipla escolha (livre)',
  final: 'Final (envia)',
};

/** Converte `condition` antiga em `rules` (uma vez, ao abrir no construtor). */
export function normalizeSteps(steps: TypebotStep[]): TypebotStep[] {
  return (steps || []).map((s) => {
    if (s.rules || !s.condition) return s;
    const rules = legacyConditionToRules(s.condition);
    return rules.length ? { ...s, rules, condition: undefined } : s;
  });
}

function fieldTypeOfStep(step: TypebotStep, byId: Map<string, LeadFieldDefinition>): LeadFieldType {
  if (step.type === 'ask_field') return byId.get(step.field_id || '')?.field_type || 'text';
  if (step.type === 'ask_multichoice') return 'multiselect';
  if (step.type === 'ask_choice') return 'select';
  return 'text';
}

function stepOptions(step: TypebotStep, byId: Map<string, LeadFieldDefinition>) {
  if (step.type === 'ask_field') {
    const f = byId.get(step.field_id || '');
    return f ? optionsForField(f) : [];
  }
  return step.options || [];
}

export function stepTitle(step: TypebotStep, byId: Map<string, LeadFieldDefinition>): string {
  if (step.type === 'ask_field') return byId.get(step.field_id || '')?.label || 'Campo (não definido)';
  if (step.type === 'ask_choice' || step.type === 'ask_multichoice') return step.field_key || STEP_TYPE_LABELS[step.type];
  return STEP_TYPE_LABELS[step.type] || step.type;
}

/** Lista completa de passos com regras. */
export function TypebotFlowEditor({
  steps,
  onChange,
}: {
  steps: TypebotStep[];
  onChange: (steps: TypebotStep[]) => void;
}) {
  const { fields, byId } = useLeadFieldDefinitions({ activeOnly: true });

  function update(idx: number, patch: Partial<TypebotStep>) {
    const next = [...steps];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }
  function remove(idx: number) {
    onChange(steps.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }
  function add() {
    const next = [...steps];
    const insertAt = next.length > 0 && next[next.length - 1].type === 'final' ? next.length - 1 : next.length;
    next.splice(insertAt, 0, { id: String(Date.now()), type: 'ask_field', text: 'Pergunta?', rules: [] });
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Fluxo de perguntas</h3>
        <Button size="sm" onClick={add}><Plus className="h-4 w-4 mr-1" /> Passo</Button>
      </div>

      {steps.map((step, idx) => {
        const canHaveRules = step.type === 'ask_field' || step.type === 'ask_choice' || step.type === 'ask_multichoice';
        const ftype = fieldTypeOfStep(step, byId);
        const opts = stepOptions(step, byId);
        const def = step.type === 'ask_field' ? byId.get(step.field_id || '') : undefined;
        return (
          <Card key={step.id || idx} className="p-3 bg-muted/30 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] shrink-0">#{idx + 1}</Badge>
              <select
                value={step.type}
                onChange={(e) => update(idx, { type: e.target.value as TypebotStep['type'] })}
                className="text-xs bg-background border rounded px-2 py-1"
              >
                {(Object.keys(STEP_TYPE_LABELS) as TypebotStep['type'][]).map((t) => (
                  <option key={t} value={t}>{STEP_TYPE_LABELS[t]}</option>
                ))}
              </select>
              <div className="flex-1" />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(idx, -1)}><ArrowUp className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(idx, 1)}><ArrowDown className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(idx)}><Trash2 className="h-3 w-3" /></Button>
            </div>

            <RichTextEditor value={step.text || ''} onChange={(html) => update(idx, { text: html })} minHeight={60} />

            {(step.type === 'ask_name' || step.type === 'ask_phone') && (
              <Input
                value={step.placeholder || ''}
                onChange={(e) => update(idx, { placeholder: e.target.value })}
                placeholder="Placeholder do input"
              />
            )}

            {step.type === 'ask_field' && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <Label className="text-xs">Campo do catálogo (grava padronizado na ficha do lead)</Label>
                  <select
                    value={step.field_id || ''}
                    onChange={(e) => {
                      const f = byId.get(e.target.value);
                      update(idx, { field_id: e.target.value || undefined, field_key: f?.key, required: step.required ?? f?.required, rules: [] });
                    }}
                    className="w-full text-sm bg-background border rounded px-2 py-2"
                  >
                    <option value="">— escolha um campo —</option>
                    {fields.map((f) => (
                      <option key={f.id} value={f.id}>{f.label} · {LEAD_FIELD_TYPE_LABELS[f.field_type]}</option>
                    ))}
                  </select>
                  {def && isChoiceType(def.field_type) && (
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Opções: {optionsForField(def).map((o) => o.label).join(' · ')}
                    </div>
                  )}
                  {!fields.length && (
                    <div className="text-[11px] text-amber-600 mt-1">Nenhum campo ativo. Crie na aba "Campos".</div>
                  )}
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch checked={!!step.required} onCheckedChange={(v) => update(idx, { required: v })} />
                  <Label className="text-xs">Obrigatória</Label>
                </div>
              </div>
            )}

            {(step.type === 'ask_choice' || step.type === 'ask_multichoice') && (
              <ChoiceStepEditor
                step={{ ...step, condition: undefined }}
                isSingle={step.type === 'ask_choice'}
                hideCondition
                onChange={(patch) => update(idx, patch)}
              />
            )}

            {canHaveRules && (
              <RulesEditor
                rules={step.rules || []}
                fieldType={ftype}
                options={opts}
                steps={steps}
                currentIdx={idx}
                onChange={(rules) => update(idx, { rules })}
              />
            )}
          </Card>
        );
      })}

      <FlowPathSummary steps={steps} byId={byId} />
    </div>
  );
}

function RulesEditor({
  rules, fieldType, options, steps, currentIdx, onChange,
}: {
  rules: StepRule[];
  fieldType: LeadFieldType;
  options: { label: string; value: string }[];
  steps: TypebotStep[];
  currentIdx: number;
  onChange: (rules: StepRule[]) => void;
}) {
  const { byId } = useLeadFieldDefinitions({ activeOnly: false });
  const ops = operatorsForType(fieldType);
  const hasOptions = options.length > 0;
  const isNumeric = fieldType === 'number' || fieldType === 'money' || fieldType === 'date';

  function upd(i: number, patch: Partial<StepRule>) {
    const next = [...rules];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function add() {
    onChange([...rules, {
      id: `r_${Date.now()}`,
      operator: hasOptions ? 'not_in' : (isNumeric ? 'lt' : 'not_contains'),
      value: hasOptions ? [] : '',
      action: 'disqualify',
      message: 'Obrigada pelo interesse! Por enquanto não conseguimos seguir com o seu cadastro.',
      save_disqualified: true,
    }]);
  }
  function toggleListValue(i: number, v: string) {
    const cur = Array.isArray(rules[i].value) ? (rules[i].value as string[]) : [];
    upd(i, { value: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  }

  return (
    <div className="border rounded p-2 bg-background/60 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs font-semibold"><GitBranch className="h-3 w-3" /> Caminhos condicionais</div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={add}><Plus className="h-3 w-3 mr-1" /> regra</Button>
      </div>
      {rules.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Sem regras: qualquer resposta segue para o próximo passo.</p>
      )}
      {rules.map((r, i) => {
        const listOp = r.operator === 'in' || r.operator === 'not_in';
        const noValue = r.operator === 'empty' || r.operator === 'not_empty';
        return (
          <div key={r.id} className="border rounded p-2 space-y-2 text-xs bg-muted/20">
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-medium">Se a resposta</span>
              <select
                value={r.operator}
                onChange={(e) => upd(i, { operator: e.target.value as StepRule['operator'], value: (e.target.value === 'in' || e.target.value === 'not_in') ? [] : '' })}
                className="bg-background border rounded px-1 py-1"
              >
                {ops.map((o) => <option key={o} value={o}>{RULE_OPERATOR_LABELS[o]}</option>)}
              </select>
              {!noValue && (listOp && hasOptions ? (
                <div className="flex flex-wrap gap-1">
                  {options.map((o) => {
                    const sel = Array.isArray(r.value) && (r.value as string[]).includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => toggleListValue(i, o.value)}
                        className={`px-2 py-0.5 rounded border ${sel ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              ) : hasOptions && !listOp ? (
                <select
                  value={String(r.value ?? '')}
                  onChange={(e) => upd(i, { value: e.target.value })}
                  className="bg-background border rounded px-1 py-1"
                >
                  <option value="">—</option>
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <Input
                  className="h-7 w-48 text-xs"
                  value={Array.isArray(r.value) ? r.value.join(', ') : String(r.value ?? '')}
                  onChange={(e) => upd(i, { value: listOp ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : e.target.value })}
                  placeholder={isNumeric ? 'ex: 1500' : listOp ? 'valor1, valor2' : 'ex: Governador Valadares'}
                />
              ))}
              <span className="font-medium">→</span>
              <select
                value={r.action}
                onChange={(e) => upd(i, { action: e.target.value as StepRule['action'] })}
                className="bg-background border rounded px-1 py-1"
              >
                <option value="continue">continuar normalmente</option>
                <option value="skip_to_step">pular para a etapa</option>
                <option value="disqualify">encerrar e desqualificar</option>
              </select>
              {r.action === 'skip_to_step' && (
                <select
                  value={r.target_step_id || ''}
                  onChange={(e) => upd(i, { target_step_id: e.target.value })}
                  className="bg-background border rounded px-1 py-1"
                >
                  <option value="">— etapa —</option>
                  {steps.map((s, si) => si !== currentIdx && (
                    <option key={s.id} value={s.id}>#{si + 1} {stepTitle(s, byId)}</option>
                  ))}
                </select>
              )}
              <div className="flex-1" />
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {r.action !== 'continue' && (
              <div>
                <Label className="text-[11px]">Mensagem exibida ao lead</Label>
                <Textarea
                  rows={2}
                  value={r.message || ''}
                  onChange={(e) => upd(i, { message: e.target.value })}
                  placeholder="Ex: Por enquanto o crediário é só para quem mora em Governador Valadares. Obrigada!"
                  className="text-xs"
                />
              </div>
            )}
            {r.action === 'disqualify' && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={r.save_disqualified !== false} onCheckedChange={(v) => upd(i, { save_disqualified: v })} />
                  <Label className="text-[11px]">Gravar lead como desqualificado</Label>
                </div>
                <Input
                  className="h-7 w-56 text-xs"
                  value={r.reason || ''}
                  onChange={(e) => upd(i, { reason: e.target.value })}
                  placeholder="Motivo interno (ex: fora de GV)"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Resumo visual "Pergunta → destino" para conferir os caminhos. */
export function FlowPathSummary({ steps, byId }: { steps: TypebotStep[]; byId: Map<string, LeadFieldDefinition> }) {
  const withRules = steps.filter((s) => (s.rules || []).length > 0);
  if (withRules.length === 0) return null;
  const idxOf = (id?: string) => steps.findIndex((s) => s.id === id);
  return (
    <Card className="p-3 bg-muted/20">
      <div className="flex items-center gap-1 text-xs font-semibold mb-2"><GitBranch className="h-3 w-3" /> Mapa dos caminhos</div>
      <div className="space-y-1 text-xs">
        {withRules.map((s) => {
          const i = steps.indexOf(s);
          return (
            <div key={s.id}>
              <div className="font-medium">#{i + 1} {stepTitle(s, byId)}</div>
              {(s.rules || []).map((r) => (
                <div key={r.id} className="flex items-center gap-1 pl-3 text-muted-foreground">
                  <CornerDownRight className="h-3 w-3" />
                  <span>{RULE_OPERATOR_LABELS[r.operator]} {Array.isArray(r.value) ? r.value.join(', ') : String(r.value ?? '')}</span>
                  <span>→</span>
                  {r.action === 'disqualify' && <Badge variant="destructive" className="text-[10px]">desqualifica{r.save_disqualified === false ? ' (não grava)' : ''}</Badge>}
                  {r.action === 'skip_to_step' && <Badge variant="secondary" className="text-[10px]">pula para #{idxOf(r.target_step_id) + 1 || '?'}</Badge>}
                  {r.action === 'continue' && <Badge variant="outline" className="text-[10px]">continua</Badge>}
                </div>
              ))}
              <div className="flex items-center gap-1 pl-3 text-muted-foreground">
                <CornerDownRight className="h-3 w-3" /><span>demais respostas → #{i + 2 <= steps.length ? i + 2 : 'fim'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
