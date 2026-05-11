import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Loader2, Share2, Copy, Check, Users, Gift, Calendar } from 'lucide-react';
import { toast } from 'sonner';

type Block =
  | { type: 'hero'; image?: string; height?: number; overlay?: number; blur?: number; position?: 'top' | 'center' | 'bottom'; mode?: 'cover' | 'contain' }
  | { type: 'title'; text: string; subtitle?: string }
  | { type: 'countdown'; target?: string; label?: string }
  | { type: 'text'; html: string }
  | { type: 'rules'; items: string[] }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'form'; cta?: string; consent?: boolean }
  | { type: 'cta'; text: string; url: string };

interface LPData {
  id: string;
  event_id: string;
  slug: string;
  title: string;
  hero_image_url: string | null;
  theme_json: { primary?: string; background?: string; font?: string };
  config_json: { blocks: Block[] };
  vip_group_link: string | null;
  success_message: string | null;
  prize_description: string | null;
  event_starts_at: string | null;
  require_privacy_consent: boolean;
}

function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, new Date(target).getTime() - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return (
    <div className="flex gap-3 justify-center my-4">
      {[
        { v: d, l: 'dias' },
        { v: h, l: 'horas' },
        { v: m, l: 'min' },
        { v: s, l: 'seg' },
      ].map((x, i) => (
        <div key={i} className="bg-white/10 backdrop-blur rounded-lg px-4 py-3 min-w-[70px]">
          <div className="text-3xl font-bold text-white">{String(x.v).padStart(2, '0')}</div>
          <div className="text-xs text-white/70 uppercase">{x.l}</div>
        </div>
      ))}
    </div>
  );
}

export default function EventLandingView() {
  const { slug } = useParams<{ slug: string }>();
  const [search] = useSearchParams();
  const refToken = search.get('ref');
  const [lp, setLp] = useState<LPData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<any>(null);
  const [form, setForm] = useState({ name: '', phone: '', consent: false });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      if (!slug) return;
      const { data, error } = await supabase
        .from('event_landing_pages')
        .select('*')
        .eq('slug', slug)
        .eq('published', true)
        .maybeSingle();
      if (error || !data) {
        setLp(null);
      } else {
        setLp(data as any);
        if (data.title) document.title = data.title;
      }
      setLoading(false);
    })();
  }, [slug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lp) return;
    if (!form.name.trim() || form.phone.replace(/\D/g, '').length < 10) {
      toast.error('Preencha nome e WhatsApp válido');
      return;
    }
    if (lp.require_privacy_consent && !form.consent) {
      toast.error('Aceite a política de privacidade');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('event-lead-capture', {
        body: {
          event_id: lp.event_id,
          source: 'lp',
          landing_page_id: lp.id,
          slug: lp.slug,
          name: form.name,
          phone: form.phone,
          ref_token: refToken || undefined,
          utm_source: search.get('utm_source'),
          utm_medium: search.get('utm_medium'),
          utm_campaign: search.get('utm_campaign'),
        },
      });
      if (error) throw error;
      setSuccess(data);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao cadastrar');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  if (!lp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold mb-2">Página não encontrada</h1>
          <p className="text-white/60">Esta landing page não está publicada.</p>
        </div>
      </div>
    );
  }

  const theme = lp.theme_json || {};
  const bg = theme.background || '#0f172a';
  const primary = theme.primary || '#facc15';

  if (success) {
    // Redirect immediately to VIP group if link is available
    if (success.vip_group_link) {
      window.location.href = success.vip_group_link;
      return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: bg, fontFamily: theme.font || 'Inter' }}>
          <div className="text-center text-white">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" style={{ color: primary }} />
            <p className="text-lg font-medium">Cadastro confirmado! Redirecionando...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen p-4 sm:p-8" style={{ background: bg, fontFamily: theme.font || 'Inter' }}>
        <div className="max-w-xl mx-auto pt-8">
          <Card className="p-6 bg-white/5 border-white/10 text-white">
            <div className="text-center">
              <div className="inline-flex h-16 w-16 rounded-full items-center justify-center mb-4" style={{ background: primary }}>
                <Check className="h-8 w-8 text-slate-900" />
              </div>
              <h1 className="text-2xl font-bold mb-2">
                {success.already_registered ? 'Você já estava cadastrado!' : 'Cadastro confirmado!'}
              </h1>
              <p className="text-white/80">{lp.success_message}</p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: bg, fontFamily: theme.font || 'Inter' }}>
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        {(lp.config_json?.blocks || []).map((block, i) => {
          if (block.type === 'hero') {
            const heroImage = block.image || lp.hero_image_url;
            return (
              <div
                key={i}
                className="relative rounded-2xl overflow-hidden mb-6"
                style={{ height: block.height || 280 }}
              >
                {heroImage && (
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `url(${heroImage})`,
                      backgroundSize: block.mode || 'cover',
                      backgroundPosition: block.position || 'center',
                      backgroundRepeat: 'no-repeat',
                      filter: block.blur ? `blur(${block.blur}px)` : undefined,
                    }}
                  />
                )}
                {block.overlay !== undefined && block.overlay > 0 && (
                  <div className="absolute inset-0 bg-black" style={{ opacity: (block.overlay || 0) / 100 }} />
                )}
              </div>
            );
          }
          if (block.type === 'title') {
            return (
              <div key={i} className="text-center mb-4 text-white">
                <h1 className="text-3xl sm:text-4xl font-extrabold mb-2">{block.text}</h1>
                {block.subtitle && <p className="text-white/70 text-lg">{block.subtitle}</p>}
              </div>
            );
          }
          if (block.type === 'countdown' && block.target) {
            return (
              <div key={i} className="mb-6">
                {block.label && <p className="text-center text-white/70 uppercase text-sm mb-2">{block.label}</p>}
                <Countdown target={block.target} />
              </div>
            );
          }
          if (block.type === 'text') {
            return (
              <div
                key={i}
                className="text-white/90 mb-4 prose prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            );
          }
          if (block.type === 'rules') {
            return (
              <Card key={i} className="bg-white/5 border-white/10 p-4 mb-4">
                <ul className="space-y-2 text-white/90">
                  {block.items.map((it, j) => (
                    <li key={j} className="flex gap-2">
                      <span style={{ color: primary }}>•</span> {it}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          }
          if (block.type === 'image') {
            return <img key={i} src={block.url} alt={block.alt || ''} className="w-full rounded-lg mb-4" />;
          }
          if (block.type === 'cta') {
            return (
              <Button
                key={i}
                className="w-full text-slate-900 font-bold mb-4"
                style={{ background: primary }}
                onClick={() => window.open(block.url, '_blank')}
              >
                {block.text}
              </Button>
            );
          }
          if (block.type === 'form') {
            return (
              <Card key={i} className="bg-white/5 border-white/10 p-5 mb-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <Label className="text-white">Nome</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="bg-white/10 border-white/20 text-white"
                      placeholder="Seu nome completo"
                      required
                    />
                  </div>
                  <div>
                    <Label className="text-white">WhatsApp</Label>
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="bg-white/10 border-white/20 text-white"
                      placeholder="(11) 99999-9999"
                      required
                    />
                  </div>
                  {lp.require_privacy_consent && (
                    <label className="flex items-start gap-2 text-sm text-white/70">
                      <input
                        type="checkbox"
                        checked={form.consent}
                        onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                        className="mt-1"
                      />
                      <span>Aceito receber comunicações e a política de privacidade.</span>
                    </label>
                  )}
                  <Button
                    type="submit"
                    className="w-full text-slate-900 font-bold"
                    style={{ background: primary }}
                    disabled={submitting}
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (block.cta || 'Garantir meu lugar')}
                  </Button>
                </form>
              </Card>
            );
          }
          return null;
        })}
        {lp.event_starts_at && (
          <p className="text-center text-white/60 text-sm flex items-center justify-center gap-2 mt-4">
            <Calendar className="h-4 w-4" />
            {new Date(lp.event_starts_at).toLocaleString('pt-BR')}
          </p>
        )}
      </div>
    </div>
  );
}
