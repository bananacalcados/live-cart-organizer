import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2 } from "lucide-react";

const VIP_REDIRECT = '/vip/liveconsumidor';
const CAMPAIGN_TAG = 'live-consumidor-mar26';

const LIVE_DATE = new Date('2026-03-14T15:00:00-03:00');

function useCountdown(target: Date) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const diff = Math.max(0, target.getTime() - now);
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff % 86400000) / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000),
    isLive: diff <= 0,
  };
}

export default function LiveConsumidorLP() {
  const { d, h, m, s, isLive } = useCountdown(LIVE_DATE);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || submitting) return;
    setSubmitting(true);

    // Non-blocking save — redirect immediately
    supabase.from('lp_leads').insert({
      campaign_tag: CAMPAIGN_TAG,
      name: name.trim(),
      phone: phone.trim(),
      source: 'landing_page',
    }).then(() => {});

    setSubmitted(true);
    // Redirect fast — don't wait for DB
    setTimeout(() => { window.location.href = VIP_REDIRECT; }, 1200);
  };

  const CD = ({ v, l }: { v: number; l: string }) => (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        borderRadius: 8,
        width: 52, height: 48,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid rgba(255,255,255,0.12)',
      }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
          {String(v).padStart(2, '0')}
        </span>
      </div>
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', letterSpacing: 1, textTransform: 'uppercase', marginTop: 2, display: 'block' }}>
        {l}
      </span>
    </div>
  );

  return (
    <div style={{
      height: '100dvh',
      overflow: 'hidden',
      position: 'relative',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#fff',
    }}>
      {/* Full-screen background image */}
      <img
        src="/images/live-hero.webp"
        alt="Live Shopping"
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
        }}
      />
      {/* Gradient overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.88) 65%, rgba(0,0,0,0.95) 100%)',
      }} />

      {/* Content */}
      <div style={{
        position: 'relative', zIndex: 1,
        height: '100%',
        display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '0 20px 24px',
      }}>
        {/* Title section */}
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{
            display: 'inline-block',
            background: '#e53e3e',
            fontSize: 10, fontWeight: 700,
            padding: '3px 10px', borderRadius: 50,
            letterSpacing: 1.2, textTransform: 'uppercase',
            marginBottom: 6,
          }}>
            {isLive ? '🔴 AO VIVO AGORA' : '📅 14 e 15 de Março • 15h'}
          </div>
          <h1 style={{
            fontSize: 21, fontWeight: 800, lineHeight: 1.15, margin: '0 0 4px',
            textShadow: '0 2px 12px rgba(0,0,0,0.5)',
          }}>
            Live Shopping<br />Dia do Consumidor
          </h1>
        </div>

        {/* Countdown */}
        {!isLive && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 14 }}>
            <CD v={d} l="Dias" /><CD v={h} l="Hrs" /><CD v={m} l="Min" /><CD v={s} l="Seg" />
          </div>
        )}

        {/* Benefits row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 6, marginBottom: 14,
        }}>
          {[
            { emoji: '🦶', text: 'Ortopédicos originais' },
            { emoji: '💰', text: 'De R$99 a R$299' },
            { emoji: '🚚', text: 'Frete R$19,99 Brasil' },
            { emoji: '🎁', text: 'Sorteios ao vivo' },
          ].map((b, i) => (
            <div key={i} style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '8px 10px',
              fontSize: 12, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>{b.emoji}</span> {b.text}
            </div>
          ))}
        </div>

        {/* Form or success */}
        {submitted ? (
          <div style={{
            background: 'rgba(56,161,105,0.2)',
            border: '1px solid rgba(56,161,105,0.4)',
            borderRadius: 12, padding: '16px', textAlign: 'center',
          }}>
            <CheckCircle2 style={{ width: 32, height: 32, color: '#38a169', margin: '0 auto 8px' }} />
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Entrando no grupo VIP... 💬</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              placeholder="Seu nome"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: '#fff', borderRadius: 10,
                height: 44, padding: '0 14px',
                fontSize: 14, outline: 'none',
                width: '100%', boxSizing: 'border-box',
              }}
            />
            <input
              placeholder="WhatsApp (com DDD)"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
              type="tel"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: '#fff', borderRadius: 10,
                height: 44, padding: '0 14px',
                fontSize: 14, outline: 'none',
                width: '100%', boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: 'linear-gradient(135deg, #25D366, #128C7E)',
                color: '#fff', border: 'none', borderRadius: 10,
                height: 48, fontSize: 15, fontWeight: 700,
                cursor: 'pointer', width: '100%',
              }}
            >
              {submitting ? '⏳ Entrando...' : '💬 Entrar no Grupo VIP'}
            </button>
            <p style={{
              fontSize: 10, color: 'rgba(255,255,255,0.4)',
              textAlign: 'center', margin: '2px 0 0',
            }}>
              Entregamos para todo o Brasil 🇧🇷
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
