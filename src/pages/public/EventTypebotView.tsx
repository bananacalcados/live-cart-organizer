import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { initMetaPixel, trackPageView, trackPixelEvent } from '@/lib/metaPixel';

interface Step {
  id: string;
  type: 'message' | 'ask_name' | 'ask_phone' | 'final';
  text: string;
  placeholder?: string;
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
  const [collected, setCollected] = useState<{ name?: string; phone?: string }>({});
  const [done, setDone] = useState<any>(null);
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

  async function submitFinal(updated: { name?: string; phone?: string }) {
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
        },
      });
      if (error) throw error;
      setDone(data);
      setMessages((m) => [...m, { from: 'bot', text: tb.success_message }]);

      // Meta Pixel — Lead (browser + CAPI dedupe via event_id)
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

      // Auto-redirect to VIP group immediately if link is configured
      if (data?.vip_group_link) {
        window.location.href = data.vip_group_link;
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao cadastrar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleAnswer() {
    if (!currentStep) return;
    const value = input.trim();
    if (!value) return;

    if (currentStep.type === 'ask_phone' && value.replace(/\D/g, '').length < 10) {
      toast.error('WhatsApp inválido');
      return;
    }

    const newCollected = { ...collected };
    if (currentStep.type === 'ask_name') newCollected.name = value;
    if (currentStep.type === 'ask_phone') newCollected.phone = value;

    setCollected(newCollected);
    setMessages((m) => [...m, { from: 'user', text: value }]);
    setInput('');

    const nextIdx = stepIdx + 1;
    setStepIdx(nextIdx);

    const next = steps[nextIdx];
    if (next) {
      setTimeout(() => setMessages((m) => [...m, { from: 'bot', text: next.text }]), 400);
      if (next.type === 'final') {
        setTimeout(() => submitFinal(newCollected), 800);
      }
    } else {
      // No more steps — submit
      submitFinal(newCollected);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: bg }}>
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col p-4">
        <div className="text-center text-white mb-4 pt-4">
          <h1 className="text-xl font-bold">{tb.name}</h1>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-2 p-2"
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 whitespace-pre-line prose prose-sm prose-invert max-w-none [&_p]:my-0 ${
                  m.from === 'user'
                    ? 'text-slate-900 font-medium'
                    : 'bg-white/10 text-white'
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
        ) : currentStep && currentStep.type !== 'message' && currentStep.type !== 'final' ? (
          <div className="flex gap-2 mt-4">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAnswer()}
              placeholder={currentStep.placeholder || 'Digite aqui...'}
              className="bg-white/10 border-white/20 text-white"
              autoFocus
              disabled={submitting}
            />
            <Button onClick={handleAnswer} style={{ background: primary }} className="text-slate-900" disabled={submitting}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
