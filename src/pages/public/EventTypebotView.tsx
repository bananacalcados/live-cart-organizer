import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { initMetaPixel, trackPageView, trackPixelEvent } from '@/lib/metaPixel';

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
  type: 'message' | 'ask_name' | 'ask_phone' | 'ask_choice' | 'ask_multichoice' | 'final';
  text: string;
  placeholder?: string;
  field_key?: string;
  options?: StepOption[];
  required?: boolean;
  condition?: StepCondition | null;
}

interface TypebotData {
  id: string;
  event_id: string;
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
    opts: { disqualified?: boolean } = {},
  ) {
    if (!tb) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('event-lead-capture', {
        body: {
          event_id: tb.event_id,
          source: 'typebot',
          typebot_id: tb.id,
          slug: tb.slug,
          name: updated.name,
          phone: updated.phone,
          ref_token: refToken || undefined,
          utm_source: search.get('utm_source'),
          utm_medium: search.get('utm_medium'),
          utm_campaign: search.get('utm_campaign'),
          custom_fields: updated.custom_fields,
          disqualified: opts.disqualified === true,
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
          const phoneDigits = (updated.phone || '').replace(/\D/g, '');
          const today = new Date().toISOString().slice(0, 10);
          const eventId = `lead_${phoneDigits}_${tb.event_id}_${today}`;
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
              event_name: 'Lead',
              campaign_id: tb.event_id,
              campaign_slug: tb.slug,
              campaign_name: tb.name,
              full_name: updated.name,
              source_url: window.location.href,
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

  function handleTextAnswer() {
    if (!currentStep) return;
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

    // Evaluate condition
    const cond = currentStep.condition;
    if (cond && Array.isArray(cond.allowed_values) && cond.allowed_values.length > 0) {
      const passes = cond.allowed_values.includes(opt.value);
      if (!passes) {
        const failMsg = cond.fail_message || 'Obrigada pelo interesse!';
        setTimeout(() => setMessages((m) => [...m, { from: 'bot', text: failMsg }]), 400);
        if (cond.on_fail === 'skip_to_step' && cond.skip_to_step_id) {
          const targetIdx = steps.findIndex((s) => s.id === cond.skip_to_step_id);
          if (targetIdx >= 0) {
            advanceTo(targetIdx, updated);
            return;
          }
        }
        // end_flow (default)
        setEnded(true);
        if (cond.save_lead_when_disqualified) {
          setTimeout(() => submitFinal(updated, { disqualified: true }), 600);
        }
        return;
      }
    }

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
    advanceTo(stepIdx + 1, updated);
  }

  function toggleMulti(value: string) {
    setMultiSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  const showTextInput =
    currentStep && (currentStep.type === 'ask_name' || currentStep.type === 'ask_phone');
  const showChoiceSingle = currentStep && currentStep.type === 'ask_choice';
  const showChoiceMulti = currentStep && currentStep.type === 'ask_multichoice';

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
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTextAnswer()}
              placeholder={currentStep!.placeholder || 'Digite aqui...'}
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
            {(currentStep!.options || []).map((opt) => (
              <Button
                key={opt.value}
                onClick={() => handleChoiceSingle(opt)}
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
              {(currentStep!.options || []).map((opt) => {
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
              onClick={handleChoiceMulti}
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
