import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getFbp, getFbc } from '@/lib/metaPixel';
import { captureAttribution, resolveFbclid, resolveUtm } from '@/lib/metaAttribution';
import { normalizeBRPhone } from '@/lib/phoneUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { initMetaPixel, trackPageView, trackPixelEvent } from '@/lib/metaPixel';
import {
  evaluateRules, legacyConditionToRules, validateAnswer, maskInput, inputPlaceholder, lookupCep,
  optionsForField, isChoiceType, type StepRule, type LeadFieldDefinition, type LeadFieldType,
} from '@/lib/leadFields';

interface StepOption { label: string; value: string; }
interface StepCondition {
  allowed_values?: string[];
  on_fail?: 'end_flow' | 'skip_to_step';
  fail_message?: string;
  skip_to_step_id?: string;
  save_lead_when_disqualified?: boolean;
}
interface Step {
  id: string;
  type: 'message' | 'ask_name' | 'ask_phone' | 'ask_field' | 'ask_choice' | 'ask_multichoice' | 'final';
  text: string;
  placeholder?: string;
  field_id?: string;
  field_key?: string;
  options?: StepOption[];
  required?: boolean;
  condition?: StepCondition | null;
  rules?: StepRule[];
}

interface TypebotData {
  id: string;
  event_id: string | null;
  slug: string;
  name: string;
  theme_json: { primary?: string; background?: string };
  flow_json: { steps: Step[] };
  welcome_message: string;
  success_message: string;
  vip_group_link: string | null;
  prize_description: string | null;
}

type ChatMsg = { from: 'bot' | 'user'; text: string };

export default function EventTypebotView() {
  const { slug } = useParams<{ slug: string }>();
  // Etapa E — captura sinais de clique/UTM na entrada (memória de 90 dias).
  useEffect(() => { captureAttribution(); }, []);
  const [search] = useSearchParams();
  const refToken = search.get('ref');
  const [tb, setTb] = useState<TypebotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [input, setInput] = useState('');
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [collected, setCollected] = useState<{ name?: string; phone?: string; custom_fields: Record<string, any> }>({ custom_fields: {} });
  const [done, setDone] = useState<any>(null);
  const [ended, setEnded] = useState(false);
  const [fieldDefs, setFieldDefs] = useState<Map<string, LeadFieldDefinition>>(new Map());
  const [disqReason, setDisqReason] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      if (!slug) return;
      const { data } = await supabase
        .from('event_typebots')
        .select('*')
        .eq('slug', slug)
        .eq('published', true)
        .maybeSingle();
      if (data) {
        const typed = data as any as TypebotData;
        setTb(typed);
        const stepsAll: Step[] = typed.flow_json?.steps || [];
        const ids = stepsAll.filter((st) => st.type === 'ask_field' && st.field_id).map((st) => st.field_id!);
        if (ids.length) {
          const { data: defs } = await supabase
            .from('lead_field_definitions' as any)
            .select('*')
            .in('id', ids);
          setFieldDefs(new Map(((defs || []) as any[]).map((d) => [d.id, { ...d, options: Array.isArray(d.options) ? d.options : [] }])));
        }
        document.title = typed.name || 'Cadastro';
        const steps: Step[] = typed.flow_json?.steps || [];
        const queue: ChatMsg[] = [{ from: 'bot', text: typed.welcome_message }];
        if (steps[0]) queue.push({ from: 'bot', text: steps[0].text });
        setMessages(queue);
      }
      setLoading(false);
    })();
  }, [slug]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Reset multi-selection when moving between steps
  useEffect(() => {
    setMultiSelected([]);
  }, [stepIdx]);

  // Meta Pixel — PageView on mount
  useEffect(() => {
    initMetaPixel();
    trackPageView();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
      </div>
    );
  }
  if (!tb) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Typebot não encontrado</h1>
        </div>
      </div>
    );
  }

  const theme = tb.theme_json || {};
  const bg = theme.background || '#0f172a';
  const primary = theme.primary || '#facc15';
  const steps: Step[] = tb.flow_json?.steps || [];
  const currentStep = steps[stepIdx];

  async function submitFinal(
    updated: { name?: string; phone?: string; custom_fields: Record<string, any> },
    opts: { disqualified?: boolean; reason?: string | null } = {},
  ) {
    if (!tb) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('event-lead-capture', {
        body: {
          // Typebots globais não têm evento fixo — o backend resolve a live no ar.
          event_id: tb.event_id ?? null,
          source: 'typebot',
          typebot_id: tb.id,
          slug: tb.slug,
          name: updated.name,
          phone: updated.phone,
          ref_token: refToken || undefined,
          utm_source: resolveUtm('utm_source'),
          utm_medium: resolveUtm('utm_medium'),
          utm_campaign: resolveUtm('utm_campaign'),
          utm_content: resolveUtm('utm_content'),
          utm_term: resolveUtm('utm_term'),
          link_tag: search.get('tag') || search.get('src') || null,
          // Sinais de clique da Meta (memória de atribuição de 90 dias)
          fbclid: resolveFbclid(),
          fbp: getFbp(),
          fbc: getFbc(),
          source_url: window.location.href,
          custom_fields: updated.custom_fields,
          disqualified: opts.disqualified === true,
          disqualify_reason: opts.disqualified ? (opts.reason || disqReason || null) : null,
        },
      });
      if (error) throw error;
      setDone(data);
      if (data?.skipped) {
        // Backend chose not to persist a disqualified lead
      } else {
        setMessages((m) => [...m, { from: 'bot', text: tb.success_message }]);
      }

      // Meta Pixel — Lead (skip when disqualified)
      if (!opts.disqualified) {
        try {
          // IMPORTANTE: o event_id do Pixel e da CAPI precisam ser IDÊNTICOS
          // para a Meta deduplicar. Usa telefone normalizado (55+DDD+9 dígitos)
          // e envia o mesmo event_id explicitamente para a CAPI.
          const phoneDigits = normalizeBRPhone(updated.phone || '');
          const today = new Date().toISOString().slice(0, 10);
          const scopeId = data?.event_id || tb.event_id || tb.id;
          const eventId = `lead_${phoneDigits}_${scopeId}_${today}`;
          trackPixelEvent(
            'Lead',
            {
              content_name: tb.name,
              content_category: 'typebot_lead',
              content_ids: [tb.slug],
            },
            { eventID: eventId },
          );
          supabase.functions.invoke('meta-capi-lead', {
            body: {
              phone: phoneDigits,
              event_id: eventId,
              event_name: 'Lead',
              campaign_id: scopeId,
              campaign_slug: tb.slug,
              campaign_name: tb.name,
              full_name: updated.name,
              source_url: window.location.href,
              fbp: getFbp() || undefined,
              fbc: getFbc() || undefined,
            },
          }).catch((e) => console.warn('[meta-capi-lead] invoke error', e));
        } catch (e) {
          console.warn('[typebot-pixel] lead error', e);
        }
      }

      if (data?.vip_group_link && !opts.disqualified) {
        window.location.href = data.vip_group_link;
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao cadastrar');
    } finally {
      setSubmitting(false);
    }
  }

  function advanceTo(nextIdx: number, updatedCollected: typeof collected) {
    setStepIdx(nextIdx);
    const next = steps[nextIdx];
    if (next) {
      setTimeout(() => setMessages((m) => [...m, { from: 'bot', text: next.text }]), 400);
      if (next.type === 'final') {
        setTimeout(() => submitFinal(updatedCollected), 800);
      }
    } else {
      submitFinal(updatedCollected);
    }
  }

  function commitAnswer(answerLabel: string, updatedCollected: typeof collected) {
    setCollected(updatedCollected);
    setMessages((m) => [...m, { from: 'user', text: answerLabel }]);
    setInput('');
  }

  /** Regras do passo (novas) ou condição antiga convertida. Retorna true se o fluxo foi desviado. */
  function applyRules(step: Step, answer: unknown, fieldType: LeadFieldType, updated: typeof collected): boolean {
    const rules = (step.rules && step.rules.length) ? step.rules : legacyConditionToRules(step.condition);
    const hit = evaluateRules(rules, answer, fieldType);
    if (!hit || hit.action === 'continue') return false;
    if (hit.message) setTimeout(() => setMessages((m) => [...m, { from: 'bot', text: hit.message! }]), 400);
    if (hit.action === 'skip_to_step' && hit.target_step_id) {
      const targetIdx = steps.findIndex((s) => s.id === hit.target_step_id);
      if (targetIdx >= 0) { advanceTo(targetIdx, updated); return true; }
      return false;
    }
    // disqualify
    setEnded(true);
    setDisqReason(hit.reason || null);
    if (hit.save_disqualified !== false) {
      setTimeout(() => submitFinal(updated, { disqualified: true, reason: hit.reason || null }), 600);
    }
    return true;
  }

  function currentFieldDef(): LeadFieldDefinition | undefined {
    return currentStep?.type === 'ask_field' ? fieldDefs.get(currentStep.field_id || '') : undefined;
  }

  async function handleFieldTextAnswer() {
    if (!currentStep) return;
    const def = currentFieldDef();
    const ftype: LeadFieldType = def?.field_type || 'text';
    const raw = input.trim();
    if (!raw) {
      if (currentStep.required || def?.required) { toast.error('Preencha a resposta'); return; }
    }
    let value: unknown = null;
    let display = raw;
    if (raw) {
      const v = validateAnswer(ftype, raw);
      if (v.ok === false) { toast.error(v.error); return; }
      value = v.value; display = v.display;
    }
    const key = def?.key || currentStep.field_key || `step_${currentStep.id}`;
    const updated = { ...collected, custom_fields: { ...collected.custom_fields, [key]: value } };

    // CEP → completa endereço/bairro/cidade/estado padronizados
    if (ftype === 'cep' && value) {
      const addr = await lookupCep(String(value));
      if (addr) {
        if (addr.endereco) updated.custom_fields.endereco = addr.endereco;
        if (addr.bairro) updated.custom_fields.bairro = addr.bairro;
        if (addr.cidade) updated.custom_fields.cidade = addr.cidade;
        if (addr.estado) updated.custom_fields.estado = addr.estado;
        const resumo = [addr.endereco, addr.bairro, addr.cidade && `${addr.cidade}/${addr.estado || ''}`].filter(Boolean).join(' · ');
        if (resumo) setTimeout(() => setMessages((m) => [...m, { from: 'bot', text: `📍 ${resumo}` }]), 200);
      }
    }

    commitAnswer(display || '(em branco)', updated);
    if (applyRules(currentStep, value, ftype, updated)) return;
    advanceTo(stepIdx + 1, updated);
  }

  function handleFieldChoiceSingle(opt: StepOption) {
    if (!currentStep) return;
    const def = currentFieldDef();
    const key = def?.key || currentStep.field_key || `step_${currentStep.id}`;
    const updated = { ...collected, custom_fields: { ...collected.custom_fields, [key]: opt.value } };
    commitAnswer(opt.label, updated);
    if (applyRules(currentStep, opt.value, def?.field_type || 'select', updated)) return;
    advanceTo(stepIdx + 1, updated);
  }

  function handleFieldChoiceMulti() {
    if (!currentStep) return;
    const def = currentFieldDef();
    if ((currentStep.required || def?.required) && multiSelected.length === 0) { toast.error('Selecione pelo menos uma opção'); return; }
    const opts = def ? optionsForField(def) : [];
    const labels = opts.filter((o) => multiSelected.includes(o.value)).map((o) => o.label).join(', ');
    const key = def?.key || currentStep.field_key || `step_${currentStep.id}`;
    const updated = { ...collected, custom_fields: { ...collected.custom_fields, [key]: multiSelected } };
    commitAnswer(labels || '(nenhuma)', updated);
    if (applyRules(currentStep, multiSelected, 'multiselect', updated)) return;
    advanceTo(stepIdx + 1, updated);
  }

  function handleTextAnswer() {
    if (!currentStep) return;
    if (currentStep.type === 'ask_field') { handleFieldTextAnswer(); return; }
    const value = input.trim();
    if (!value) return;

    if (currentStep.type === 'ask_phone' && value.replace(/\D/g, '').length < 10) {
      toast.error('WhatsApp inválido');
      return;
    }

    const updated = { ...collected, custom_fields: { ...collected.custom_fields } };
    if (currentStep.type === 'ask_name') updated.name = value;
    if (currentStep.type === 'ask_phone') updated.phone = value;

    commitAnswer(value, updated);
    advanceTo(stepIdx + 1, updated);
  }

  function handleChoiceSingle(opt: StepOption) {
    if (!currentStep) return;
    const key = currentStep.field_key || `step_${currentStep.id}`;
    const updated = {
      ...collected,
      custom_fields: { ...collected.custom_fields, [key]: opt.value },
    };
    commitAnswer(opt.label, updated);

    if (applyRules(currentStep, opt.value, 'select', updated)) return;
    advanceTo(stepIdx + 1, updated);
  }

  function handleChoiceMulti() {
    if (!currentStep) return;
    if (currentStep.required && multiSelected.length === 0) {
      toast.error('Selecione pelo menos uma opção');
      return;
    }
    const opts = currentStep.options || [];
    const labels = opts.filter((o) => multiSelected.includes(o.value)).map((o) => o.label).join(', ');
    const key = currentStep.field_key || `step_${currentStep.id}`;
    const updated = {
      ...collected,
      custom_fields: { ...collected.custom_fields, [key]: multiSelected },
    };
    commitAnswer(labels || '(nenhuma)', updated);
    if (applyRules(currentStep, multiSelected, 'multiselect', updated)) return;
    advanceTo(stepIdx + 1, updated);
  }

  function toggleMulti(value: string) {
    setMultiSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  const curDef = currentStep?.type === 'ask_field' ? fieldDefs.get(currentStep.field_id || '') : undefined;
  const curFieldType: LeadFieldType = curDef?.field_type || 'text';
  const isFieldChoice = currentStep?.type === 'ask_field' && !!curDef && isChoiceType(curDef.field_type);
  const showTextInput =
    currentStep && (currentStep.type === 'ask_name' || currentStep.type === 'ask_phone' || (currentStep.type === 'ask_field' && !isFieldChoice));
  const showChoiceSingle = currentStep && (currentStep.type === 'ask_choice' || (isFieldChoice && curDef!.field_type !== 'multiselect'));
  const showChoiceMulti = currentStep && (currentStep.type === 'ask_multichoice' || (isFieldChoice && curDef!.field_type === 'multiselect'));
  const choiceOptions: StepOption[] = currentStep?.type === 'ask_field' && curDef ? optionsForField(curDef) : (currentStep?.options || []);
  const onChoiceSingle = currentStep?.type === 'ask_field' ? handleFieldChoiceSingle : handleChoiceSingle;
  const onChoiceMulti = currentStep?.type === 'ask_field' ? handleFieldChoiceMulti : handleChoiceMulti;
  const inputMode = curFieldType === 'cpf' || curFieldType === 'cep' || curFieldType === 'number' || curFieldType === 'money' || curFieldType === 'phone' ? 'numeric' : undefined;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: bg }}>
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col p-4">
        <div className="text-center text-white mb-4 pt-4">
          <h1 className="text-xl font-bold">{tb.name}</h1>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-2 p-2"
          style={{ maxHeight: 'calc(100vh - 260px)' }}
        >
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 whitespace-pre-line prose prose-sm prose-invert max-w-none [&_p]:my-0 ${
                  m.from === 'user' ? 'text-slate-900 font-medium' : 'bg-white/10 text-white'
                }`}
                style={m.from === 'user' ? { background: primary } : undefined}
                dangerouslySetInnerHTML={{ __html: m.text }}
              />
            </div>
          ))}
          {submitting && (
            <div className="flex justify-start">
              <div className="bg-white/10 text-white rounded-2xl px-4 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}
        </div>

        {done ? (
          <Card className="bg-white/5 border-white/10 p-4 mt-4 text-white text-center">
            <p className="font-medium">Cadastro confirmado!</p>
            {!done.vip_group_link && (
              <p className="text-sm text-white/70 mt-2">{tb.success_message}</p>
            )}
          </Card>
        ) : ended ? (
          <Card className="bg-white/5 border-white/10 p-4 mt-4 text-white text-center">
            <p className="text-sm text-white/80">Pode fechar essa janela.</p>
          </Card>
        ) : showTextInput ? (
          <div className="flex gap-2 mt-4">
            <Input
              value={input}
              onChange={(e) => setInput(currentStep?.type === 'ask_field' ? maskInput(curFieldType, e.target.value) : e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTextAnswer()}
              inputMode={inputMode as any}
              placeholder={currentStep!.placeholder || (currentStep?.type === 'ask_field' ? inputPlaceholder(curFieldType) : 'Digite aqui...')}
              className="bg-white/10 border-white/20 text-white"
              autoFocus
              disabled={submitting}
            />
            <Button onClick={handleTextAnswer} style={{ background: primary }} className="text-slate-900" disabled={submitting}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : showChoiceSingle ? (
          <div className="flex flex-wrap gap-2 mt-4 justify-center">
            {choiceOptions.map((opt) => (
              <Button
                key={opt.value}
                onClick={() => onChoiceSingle(opt)}
                disabled={submitting}
                className="text-slate-900"
                style={{ background: primary }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        ) : showChoiceMulti ? (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-2 justify-center">
              {choiceOptions.map((opt) => {
                const active = multiSelected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleMulti(opt.value)}
                    disabled={submitting}
                    className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      active ? 'text-slate-900' : 'text-white bg-white/10 border-white/20'
                    }`}
                    style={active ? { background: primary, borderColor: primary } : undefined}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <Button
              onClick={onChoiceMulti}
              disabled={submitting}
              style={{ background: primary }}
              className="w-full text-slate-900"
            >
              Confirmar
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
