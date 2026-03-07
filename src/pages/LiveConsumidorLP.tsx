import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Clock, Gift, Truck, RefreshCw, MapPin, ShoppingBag } from "lucide-react";

const LIVE_DATES = [
  new Date('2026-03-14T19:00:00-03:00'),
  new Date('2026-03-15T19:00:00-03:00'),
];

const VIP_REDIRECT = '/vip/liveconsumidor';
const CAMPAIGN_ID = '8c854d63-723b-40a5-9811-9a7024abb923';

function getNextLiveDate() {
  const now = new Date();
  for (const d of LIVE_DATES) {
    if (d.getTime() > now.getTime()) return d;
  }
  return LIVE_DATES[LIVE_DATES.length - 1];
}

function useCountdown(target: Date) {
  const [diff, setDiff] = useState(() => Math.max(0, target.getTime() - Date.now()));
  useEffect(() => {
    const i = setInterval(() => setDiff(Math.max(0, target.getTime() - Date.now())), 1000);
    return () => clearInterval(i);
  }, [target]);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { d, h, m, s, isLive: diff <= 0 };
}

export default function LiveConsumidorLP() {
  const target = getNextLiveDate();
  const { d, h, m, s, isLive } = useCountdown(target);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Track view
    supabase.from('campaign_landing_pages')
      .select('id, views')
      .eq('slug', 'live-consumidor')
      .eq('is_active', true)
      .single()
      .then(({ data }) => {
        if (data) {
          supabase.from('campaign_landing_pages')
            .update({ views: (data.views || 0) + 1 } as any)
            .eq('id', data.id)
            .then(() => {});
        }
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setSubmitting(true);
    try {
      await supabase.from('campaign_leads').insert({
        campaign_id: CAMPAIGN_ID,
        name: name.trim(),
        phone: phone.trim(),
        source: 'landing_page_live_consumidor',
      });
      setSubmitted(true);
      setTimeout(() => { window.location.href = VIP_REDIRECT; }, 2500);
    } catch {
      // fallback redirect
      window.location.href = VIP_REDIRECT;
    } finally {
      setSubmitting(false);
    }
  };

  const CountdownBlock = ({ value, label }: { value: number; label: string }) => (
    <div className="flex flex-col items-center">
      <div style={{
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(10px)',
        borderRadius: 12,
        width: 64,
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid rgba(255,255,255,0.15)',
      }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
          {String(value).padStart(2, '0')}
        </span>
      </div>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </span>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: '#1a1a1a',
      color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Hero */}
      <div style={{ position: 'relative', width: '100%', maxHeight: 480, overflow: 'hidden' }}>
        <img
          src="/images/live-hero.webp"
          alt="Live Shopping Banana Calçados"
          style={{ width: '100%', height: 480, objectFit: 'cover', display: 'block' }}
        />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(26,26,26,0.85) 70%, #1a1a1a 100%)',
        }} />
        <div style={{
          position: 'absolute', bottom: 24, left: 0, right: 0,
          textAlign: 'center', padding: '0 1rem',
        }}>
          <div style={{
            display: 'inline-block',
            background: '#e53e3e',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            padding: '4px 12px',
            borderRadius: 50,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            marginBottom: 12,
          }}>
            {isLive ? '🔴 AO VIVO AGORA' : '📅 14 e 15 de Março'}
          </div>
          <h1 style={{
            fontSize: 'clamp(1.5rem, 5vw, 2.2rem)',
            fontWeight: 800,
            lineHeight: 1.15,
            margin: '0 0 6px',
            textShadow: '0 2px 20px rgba(0,0,0,0.5)',
          }}>
            Live Shopping<br />Dia do Consumidor
          </h1>
          <p style={{
            fontSize: 14,
            opacity: 0.8,
            margin: 0,
          }}>
            <MapPin style={{ width: 14, height: 14, display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            Governador Valadares - MG
          </p>
        </div>
      </div>

      {/* Countdown */}
      <div style={{ padding: '28px 1rem 20px', textAlign: 'center' }}>
        {isLive ? (
          <div style={{
            background: 'linear-gradient(135deg, #e53e3e, #c53030)',
            padding: '16px 24px',
            borderRadius: 16,
            maxWidth: 380,
            margin: '0 auto',
          }}>
            <p style={{ fontSize: 18, fontWeight: 700 }}>🔴 Estamos ao vivo!</p>
            <p style={{ fontSize: 13, opacity: 0.9, margin: '4px 0 0' }}>Entre no grupo VIP para participar</p>
          </div>
        ) : (
          <>
            <p style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: 2,
              color: 'rgba(255,255,255,0.5)',
              marginBottom: 12,
            }}>
              <Clock style={{ width: 13, height: 13, display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              A live começa em
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <CountdownBlock value={d} label="Dias" />
              <CountdownBlock value={h} label="Horas" />
              <CountdownBlock value={m} label="Min" />
              <CountdownBlock value={s} label="Seg" />
            </div>
          </>
        )}
      </div>

      {/* Benefits */}
      <div style={{ padding: '0 1rem 24px', maxWidth: 420, margin: '0 auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
        }}>
          {[
            { icon: <ShoppingBag size={18} />, text: 'Até 20% OFF', color: '#e53e3e' },
            { icon: <Truck size={18} />, text: 'Frete R$ 19,99', color: '#38a169' },
            { icon: <Gift size={18} />, text: 'Sorteios ao vivo', color: '#d69e2e' },
            { icon: <RefreshCw size={18} />, text: '7 dias troca', color: '#3182ce' },
          ].map((b, i) => (
            <div key={i} style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              padding: '14px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: `${b.color}22`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: b.color,
                flexShrink: 0,
              }}>
                {b.icon}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{b.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Form / CTA */}
      <div style={{ padding: '0 1rem 40px', maxWidth: 420, margin: '0 auto' }}>
        {submitted ? (
          <div style={{
            background: 'rgba(56,161,105,0.15)',
            border: '1px solid rgba(56,161,105,0.3)',
            borderRadius: 16,
            padding: '24px',
            textAlign: 'center',
          }}>
            <CheckCircle2 style={{ width: 40, height: 40, color: '#38a169', margin: '0 auto 12px' }} />
            <p style={{ fontSize: 16, fontWeight: 700 }}>Cadastro realizado! 🎉</p>
            <p style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
              Redirecionando para o grupo VIP do WhatsApp...
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{
              fontSize: 14,
              fontWeight: 600,
              textAlign: 'center',
              marginBottom: 4,
              color: 'rgba(255,255,255,0.85)',
            }}>
              📲 Entre no grupo VIP e garanta as ofertas
            </p>
            <Input
              placeholder="Seu nome"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
                borderRadius: 12,
                height: 48,
              }}
            />
            <Input
              placeholder="WhatsApp (DDD + número)"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
              type="tel"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
                borderRadius: 12,
                height: 48,
              }}
            />
            <Button
              type="submit"
              disabled={submitting}
              style={{
                background: 'linear-gradient(135deg, #25D366, #128C7E)',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                height: 52,
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                marginTop: 4,
              }}
            >
              {submitting ? 'Entrando...' : '💬 Entrar no Grupo VIP'}
            </Button>
            <p style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.4)',
              textAlign: 'center',
              marginTop: 2,
            }}>
              Entregamos para todo o Brasil 🇧🇷
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
