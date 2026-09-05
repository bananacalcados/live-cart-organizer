/**
 * Catálogo de campos padronizados de lead + regras condicionais do Typebot.
 *
 * Usado pelo construtor (Eventos > Typebots), pelo chat público (/typebot/:slug)
 * e pelas telas de leads. Mantém compatibilidade com o formato antigo
 * (`field_key` + `condition`) convertendo-o em `rules` ao abrir no construtor.
 */
import { isValidCpf, formatCpf, onlyDigitsCpf } from '@/lib/cpfUtils';

export type LeadFieldType =
  | 'text' | 'number' | 'money' | 'cpf' | 'phone' | 'address' | 'cep'
  | 'yes_no' | 'select' | 'multiselect' | 'date';

export interface LeadFieldOption { label: string; value: string }

export interface LeadFieldDefinition {
  id: string;
  key: string;
  label: string;
  field_type: LeadFieldType;
  options: LeadFieldOption[];
  required: boolean;
  is_active: boolean;
  sort_order: number;
  description?: string | null;
  is_system?: boolean;
}

export const LEAD_FIELD_TYPE_LABELS: Record<LeadFieldType, string> = {
  text: 'Texto livre',
  number: 'Número',
  money: 'Moeda (R$)',
  cpf: 'CPF',
  phone: 'Telefone',
  address: 'Endereço',
  cep: 'CEP (preenche endereço)',
  yes_no: 'Sim / Não',
  select: 'Lista fixa (uma opção)',
  multiselect: 'Lista fixa (várias opções)',
  date: 'Data',
};

export const YES_NO_OPTIONS: LeadFieldOption[] = [
  { label: 'Sim', value: 'sim' },
  { label: 'Não', value: 'nao' },
];

/** Tipos cujas respostas são escolhidas em botões. */
export function isChoiceType(t: LeadFieldType): boolean {
  return t === 'select' || t === 'multiselect' || t === 'yes_no';
}

export function optionsForField(f: Pick<LeadFieldDefinition, 'field_type' | 'options'>): LeadFieldOption[] {
  if (f.field_type === 'yes_no') return YES_NO_OPTIONS;
  return Array.isArray(f.options) ? f.options : [];
}

// ---------------------------------------------------------------------------
// Regras condicionais
// ---------------------------------------------------------------------------
export type RuleOperator =
  | 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains' | 'empty' | 'not_empty';

export type RuleAction = 'continue' | 'skip_to_step' | 'disqualify';

export interface StepRule {
  id: string;
  operator: RuleOperator;
  /** Valor de comparação (string, número ou lista). */
  value?: string | number | string[];
  action: RuleAction;
  target_step_id?: string;
  /** Mensagem exibida ao lead quando a regra dispara. */
  message?: string;
  /** Grava o lead mesmo desqualificado. */
  save_disqualified?: boolean;
  /** Motivo interno da desqualificação (vai para a ficha). */
  reason?: string;
}

export const RULE_OPERATOR_LABELS: Record<RuleOperator, string> = {
  eq: 'é igual a',
  neq: 'é diferente de',
  in: 'é uma de',
  not_in: 'não é nenhuma de',
  gt: 'é maior que',
  gte: 'é maior ou igual a',
  lt: 'é menor que',
  lte: 'é menor ou igual a',
  contains: 'contém',
  not_contains: 'não contém',
  empty: 'está vazio',
  not_empty: 'foi preenchido',
};

export function operatorsForType(t: LeadFieldType): RuleOperator[] {
  if (t === 'number' || t === 'money' || t === 'date') return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'];
  if (isChoiceType(t)) return ['eq', 'neq', 'in', 'not_in', 'empty', 'not_empty'];
  return ['eq', 'neq', 'contains', 'not_contains', 'in', 'not_in', 'empty', 'not_empty'];
}

/** Normaliza texto para comparação (acentos, caixa, espaços). */
export function normText(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[R$\s.]/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => normText(x)).filter(Boolean);
  return String(v ?? '')
    .split(/[,;\n]/)
    .map((x) => normText(x))
    .filter(Boolean);
}

/** Avalia uma regra contra a resposta. */
export function ruleMatches(rule: StepRule, answer: unknown, fieldType: LeadFieldType): boolean {
  const isEmpty = answer === null || answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0);
  if (rule.operator === 'empty') return isEmpty;
  if (rule.operator === 'not_empty') return !isEmpty;
  if (isEmpty) return false;

  const numeric = fieldType === 'number' || fieldType === 'money';
  if (numeric || (fieldType === 'date' && ['gt', 'gte', 'lt', 'lte'].includes(rule.operator))) {
    const a = fieldType === 'date' ? Date.parse(String(answer)) : toNumber(answer);
    const b = fieldType === 'date' ? Date.parse(String(rule.value)) : toNumber(rule.value);
    if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b)) return false;
    switch (rule.operator) {
      case 'eq': return a === b;
      case 'neq': return a !== b;
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      default: return false;
    }
  }

  const answers = Array.isArray(answer) ? answer.map(normText) : [normText(answer)];
  const expectedList = listOf(rule.value);
  const expected = normText(Array.isArray(rule.value) ? rule.value[0] : rule.value);

  switch (rule.operator) {
    case 'eq': return answers.length === 1 && answers[0] === expected;
    case 'neq': return !(answers.length === 1 && answers[0] === expected);
    case 'in': return answers.some((a) => expectedList.includes(a));
    case 'not_in': return !answers.some((a) => expectedList.includes(a));
    case 'contains': return answers.some((a) => a.includes(expected));
    case 'not_contains': return !answers.some((a) => a.includes(expected));
    default: return false;
  }
}

/** Primeira regra que casa, na ordem. `continue` explícito também interrompe a avaliação. */
export function evaluateRules(rules: StepRule[] | undefined, answer: unknown, fieldType: LeadFieldType): StepRule | null {
  for (const r of rules || []) {
    if (ruleMatches(r, answer, fieldType)) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compatibilidade com o formato antigo (condition.allowed_values)
// ---------------------------------------------------------------------------
export interface LegacyCondition {
  allowed_values?: string[];
  on_fail?: 'end_flow' | 'skip_to_step';
  fail_message?: string;
  skip_to_step_id?: string;
  save_lead_when_disqualified?: boolean;
}

export function legacyConditionToRules(cond: LegacyCondition | null | undefined): StepRule[] {
  if (!cond || !Array.isArray(cond.allowed_values) || cond.allowed_values.length === 0) return [];
  return [{
    id: `legacy_${Date.now()}`,
    operator: 'not_in',
    value: cond.allowed_values,
    action: cond.on_fail === 'skip_to_step' && cond.skip_to_step_id ? 'skip_to_step' : 'disqualify',
    target_step_id: cond.skip_to_step_id,
    message: cond.fail_message || 'Obrigada pelo interesse!',
    save_disqualified: !!cond.save_lead_when_disqualified,
  }];
}

// ---------------------------------------------------------------------------
// Validação / formatação de respostas por tipo
// ---------------------------------------------------------------------------
export function validateAnswer(fieldType: LeadFieldType, raw: string): { ok: true; value: unknown; display: string } | { ok: false; error: string } {
  const v = raw.trim();
  switch (fieldType) {
    case 'cpf': {
      if (!isValidCpf(v)) return { ok: false, error: 'CPF inválido. Confira os números.' };
      return { ok: true, value: onlyDigitsCpf(v), display: formatCpf(v) };
    }
    case 'cep': {
      const d = v.replace(/\D/g, '');
      if (d.length !== 8) return { ok: false, error: 'CEP deve ter 8 números.' };
      return { ok: true, value: d, display: `${d.slice(0, 5)}-${d.slice(5)}` };
    }
    case 'phone': {
      const d = v.replace(/\D/g, '');
      if (d.length < 10 || d.length > 13) return { ok: false, error: 'Telefone inválido.' };
      return { ok: true, value: d, display: v };
    }
    case 'number': {
      const n = toNumber(v);
      if (n === null) return { ok: false, error: 'Digite apenas números.' };
      return { ok: true, value: n, display: String(n) };
    }
    case 'money': {
      const n = toNumber(v);
      if (n === null || n < 0) return { ok: false, error: 'Digite um valor em reais (ex: 1500).' };
      return { ok: true, value: Math.round(n * 100) / 100, display: formatMoney(n) };
    }
    case 'date': {
      const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : v;
      if (Number.isNaN(Date.parse(iso))) return { ok: false, error: 'Data inválida. Use dd/mm/aaaa.' };
      return { ok: true, value: iso, display: m ? v : iso };
    }
    default:
      if (!v) return { ok: false, error: 'Preencha a resposta.' };
      return { ok: true, value: v.slice(0, 300), display: v.slice(0, 300) };
  }
}

export function formatMoney(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Formata um valor gravado para exibição em listas/fichas. */
export function formatLeadValue(def: Pick<LeadFieldDefinition, 'field_type' | 'options'> | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (!def) return Array.isArray(value) ? value.join(', ') : String(value);
  const opts = optionsForField(def);
  const labelOf = (v: unknown) => opts.find((o) => o.value === String(v))?.label ?? String(v);
  switch (def.field_type) {
    case 'cpf': return formatCpf(String(value));
    case 'money': { const n = toNumber(value); return n === null ? String(value) : formatMoney(n); }
    case 'cep': { const d = String(value).replace(/\D/g, ''); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : String(value); }
    case 'date': { const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }); }
    case 'yes_no':
    case 'select': return labelOf(value);
    case 'multiselect': return Array.isArray(value) ? value.map(labelOf).join(', ') : labelOf(value);
    default: return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

export function inputPlaceholder(t: LeadFieldType): string {
  switch (t) {
    case 'cpf': return '000.000.000-00';
    case 'cep': return '00000-000';
    case 'money': return 'Ex: 1500';
    case 'number': return 'Ex: 2';
    case 'date': return 'dd/mm/aaaa';
    case 'phone': return '(33) 99999-9999';
    case 'address': return 'Rua, número, complemento';
    default: return 'Digite aqui...';
  }
}

/** Máscara leve ao digitar. */
export function maskInput(t: LeadFieldType, raw: string): string {
  if (t === 'cpf') return formatCpf(raw);
  if (t === 'cep') { const d = raw.replace(/\D/g, '').slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; }
  if (t === 'date') {
    const d = raw.replace(/\D/g, '').slice(0, 8);
    return d.replace(/^(\d{2})(\d)/, '$1/$2').replace(/^(\d{2})\/(\d{2})(\d)/, '$1/$2/$3');
  }
  return raw;
}

/** Consulta ViaCEP e devolve campos padronizados prontos para gravar. */
export async function lookupCep(cep: string): Promise<{ endereco?: string; bairro?: string; cidade?: string; estado?: string } | null> {
  const d = cep.replace(/\D/g, '');
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    if (!j || j.erro) return null;
    return { endereco: j.logradouro || undefined, bairro: j.bairro || undefined, cidade: j.localidade || undefined, estado: j.uf || undefined };
  } catch {
    return null;
  }
}

export function slugifyKey(raw: string): string {
  return normText(raw).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]/, 'f$&').slice(0, 60);
}
