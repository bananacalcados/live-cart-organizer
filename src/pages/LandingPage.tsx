import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2 } from "lucide-react";

interface LandingPage {
  id: string;
  campaign_id: string;
  slug: string;
  title: string;
  description: string | null;
  hero_image_url: string | null;
  form_fields: Array<{ name: string; label: string; type: string; required: boolean }>;
  thank_you_message: string;
  whatsapp_redirect: string | null;
  custom_css: string | null;
  is_active: boolean;
  event_date: string | null;
}

// Default fallback event date: Saturday 25/04/2026 at 15:00 BRT (UTC-3)
const DEFAULT_EVENT_TARGET_MS = Date.UTC(2026, 3, 25, 18, 0, 0);

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function useCountdown(targetMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, targetMs - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds, finished: diff === 0 };
}

function CountdownBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center min-w-[60px]">
      <div className="bg-black/70 backdrop-blur-sm border border-yellow-400/30 rounded-xl px-3 py-2 min-w-[60px] text-center">
        <span className="text-2xl md:text-3xl font-black text-yellow-400 tabular-nums">
          {String(value).padStart(2, "0")}
        </span>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-white/80 mt-1 font-semibold">{label}</span>
    </div>
  );
}

export default function LandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<LandingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const eventTargetMs = useMemo(() => {
    if (page?.event_date) {
      const t = new Date(page.event_date).getTime();
      if (!isNaN(t)) return t;
    }
    return DEFAULT_EVENT_TARGET_MS;
  }, [page?.event_date]);
  const countdown = useCountdown(eventTargetMs);

  const eventBadge = useMemo(() => {
    const d = new Date(eventTargetMs);
    const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const dia = dias[d.getDay()];
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `🔴 Ao Vivo ${dia} ${dd}/${mm} · ${hh}h${min !== '00' ? min : ''}`;
  }, [eventTargetMs]);

  useEffect(() => {
    if (!slug) return;
    const load = async () => {
      const { data, error } = await supabase
        .from('campaign_landing_pages')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single();
      if (error || !data) { setLoading(false); return; }
      setPage(data as unknown as LandingPage);
      setLoading(false);
      await supabase.from('campaign_landing_pages').update({ views: (data.views || 0) + 1 } as any).eq('id', data.id);
    };
    load();
  }, [slug]);

  // SEO
  useEffect(() => {
    if (!page) return;
    document.title = `${page.title} | Banana Calçados`;
    const desc = (page.description || '').slice(0, 155);
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', desc);
  }, [page]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!page) return;
    setSubmitting(true);
    try {
      await supabase.from('campaign_leads').insert({
        campaign_id: page.campaign_id,
        name: formData.name || formData.nome || null,
        phone: formData.phone || formData.whatsapp || formData.telefone || null,
        email: formData.email || null,
        instagram: formData.instagram || null,
        source: 'landing_page',
        metadata: formData as any,
      });
      await supabase.from('campaign_landing_pages').update({ submissions: (page as any).submissions + 1 } as any).eq('id', page.id);
      try {
        await supabase.from('marketing_campaigns').update({ leads_captured: ((page as any).submissions || 0) + 1 } as any).eq('id', page.campaign_id);
      } catch {}

      setSubmitted(true);

      if (page.whatsapp_redirect) {
        setTimeout(() => { window.location.href = page.whatsapp_redirect!; }, 2000);
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro ao enviar. Tente novamente.");
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-black"><p className="text-white/60">Carregando...</p></div>;
  if (!page) return <div className="min-h-screen flex items-center justify-center bg-black"><p className="text-white/60">Página não encontrada</p></div>;

  const fields = Array.isArray(page.form_fields) ? page.form_fields : [];

  // Parse simple **bold** markdown
  const renderRichText = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, lineIdx) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <p key={lineIdx} className={line.trim() === '' ? 'h-2' : ''}>
          {parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return (
                <strong key={i} className="font-black text-yellow-300">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            return <span key={i}>{part}</span>;
          })}
        </p>
      );
    });
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative bg-cover bg-no-repeat"
      style={
        page.hero_image_url
          ? { backgroundImage: `url(${page.hero_image_url})`, backgroundPosition: 'center 75%' }
          : { background: 'linear-gradient(135deg,#1a1a1a,#2a2a2a)' }
      }
    >
      <style>{page.custom_css || ''}</style>
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/85" />

      <div className="relative w-full max-w-md z-10">
        <div className="rounded-2xl overflow-hidden shadow-2xl border border-yellow-400/30 backdrop-blur-md bg-black/70">
          <div className="px-6 pt-7 pb-6 space-y-5">
            {submitted ? (
              <div className="text-center space-y-3 py-10">
                <CheckCircle2 className="h-14 w-14 mx-auto text-yellow-400" />
                <h2 className="text-xl font-bold text-white">{page.thank_you_message}</h2>
                {page.whatsapp_redirect && (
                  <p className="text-sm text-white/70">Redirecionando para o WhatsApp...</p>
                )}
              </div>
            ) : (
              <>
                {/* Title */}
                <div className="text-center space-y-2">
                  <span className="inline-block px-3 py-1 rounded-full bg-yellow-400/20 border border-yellow-400/40 text-yellow-300 text-[11px] uppercase tracking-widest font-bold">
                    🔴 Ao Vivo Sábado · 15h
                  </span>
                  <h1 className="text-2xl md:text-3xl font-black text-white leading-tight">
                    {page.title}
                  </h1>
                </div>

                {/* Countdown */}
                {!countdown.finished && (
                  <div className="flex justify-center gap-2">
                    <CountdownBox value={countdown.days} label="dias" />
                    <CountdownBox value={countdown.hours} label="horas" />
                    <CountdownBox value={countdown.minutes} label="min" />
                    <CountdownBox value={countdown.seconds} label="seg" />
                  </div>
                )}
                {countdown.finished && (
                  <div className="text-center bg-red-500/20 border border-red-400/40 rounded-xl py-2 px-3">
                    <p className="text-red-300 font-bold text-sm">🔴 ESTAMOS AO VIVO AGORA!</p>
                  </div>
                )}

                {/* Description with bold highlights */}
                {page.description && (
                  <div className="text-sm text-white/90 leading-relaxed text-center space-y-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                    {renderRichText(page.description)}
                  </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-3 pt-1">
                  {fields.map(field => {
                    const isTel = field.type === 'tel';
                    return (
                      <div key={field.name} className="space-y-1">
                        <Label className="text-xs text-white/80 uppercase tracking-wider font-semibold">{field.label}</Label>
                        <Input
                          type={field.type || 'text'}
                          required={field.required}
                          inputMode={isTel ? 'tel' : undefined}
                          value={formData[field.name] || ''}
                          onChange={e => {
                            const v = isTel ? formatPhone(e.target.value) : e.target.value;
                            setFormData(prev => ({ ...prev, [field.name]: v }));
                          }}
                          placeholder={field.label}
                          className="bg-white/95 border-0 text-black placeholder:text-black/40 h-11"
                        />
                      </div>
                    );
                  })}
                  <Button
                    type="submit"
                    className="w-full h-12 text-base font-bold bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-300 hover:to-amber-400 text-black shadow-lg"
                    disabled={submitting}
                  >
                    {submitting ? 'Enviando...' : 'QUERO PARTICIPAR 🔥'}
                  </Button>
                  <p className="text-[10px] text-center text-white/50">
                    Seus dados são protegidos e usados apenas para contato comercial.
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
