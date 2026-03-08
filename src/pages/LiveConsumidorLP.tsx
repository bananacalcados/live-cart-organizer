import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2 } from "lucide-react";
import { initMetaPixel, trackPageView, trackPixelEvent } from "@/lib/metaPixel";

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
  const [pushSubscription, setPushSubscription] = useState<any>(null);
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [pushDismissed, setPushDismissed] = useState(false);

  // Init Meta Pixel & fire PageView
  useEffect(() => {
    initMetaPixel();
    trackPageView();
    trackPixelEvent('ViewContent', { content_name: 'Live Consumidor LP', content_category: 'landing_page' });
  }, []);

  // Check if push is available and not yet granted
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
    // Show custom banner after short delay
    const t = setTimeout(() => setShowPushBanner(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const handleAcceptPush = async () => {
    setShowPushBanner(false);
    setPushDismissed(true);
    try {
      const registration = await navigator.serviceWorker.register('/push-sw.js');
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/push-notifications?action=vapid-public-key`, {
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      const { publicKey } = await res.json();
      if (!publicKey) return;
      const padding = '='.repeat((4 - publicKey.length % 4) % 4);
      const base64 = (publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawKey = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: rawKey,
      });
      setPushSubscription(subscription.toJSON());
    } catch (err) {
      console.log('Push permission denied or unavailable:', err);
    }
  };

  const handleDismissPush = () => {
    setShowPushBanner(false);
    setPushDismissed(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || submitting) return;
    setSubmitting(true);

    // Non-blocking save
    supabase.from('lp_leads').insert({
      campaign_tag: CAMPAIGN_TAG,
      name: name.trim(),
      phone: phone.trim(),
      source: 'landing_page',
    }).then(() => {});

    // Save push subscription with lead info (non-blocking)
    if (pushSubscription?.endpoint) {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      fetch(`${supabaseUrl}/functions/v1/push-notifications?action=subscribe`, {
        method: 'POST',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          endpoint: pushSubscription.endpoint,
          keys: pushSubscription.keys,
          campaign_tag: CAMPAIGN_TAG,
          lead_name: name.trim(),
          lead_phone: phone.trim(),
        }),
      }).catch(() => {});
    }

    setSubmitted(true);
    trackPixelEvent('Lead', { content_name: 'Live Consumidor LP', content_category: 'vip_group' });
    trackPixelEvent('CompleteRegistration', { content_name: 'Grupo VIP Live', value: 0, currency: 'BRL' });
    setTimeout(() => { window.location.href = VIP_REDIRECT; }, 600);
  };

  const CD = ({ v, l }: { v: number; l: string }) => (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        borderRadius: 10,
        width: 62, height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid rgba(255,255,255,0.12)',
      }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
          {String(v).padStart(2, '0')}
        </span>
      </div>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', letterSpacing: 1, textTransform: 'uppercase', marginTop: 3, display: 'block' }}>
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
      {/* Push notification custom banner */}
      {showPushBanner && !pushDismissed && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0,
          zIndex: 9999,
          padding: '12px 16px',
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          borderBottom: '2px solid #d4a054',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          animation: 'slideDown 0.4s ease-out',
        }}>
          <span style={{ fontSize: 28 }}>🎁</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#d4a054' }}>
              Aceite as notificações e concorra a sorteios durante a live! 🎉
            </p>
          </div>
          <button
            onClick={handleAcceptPush}
            style={{
              background: '#0d6e3a',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Ativar 🔔
          </button>
          <button
            onClick={handleDismissPush}
            style={{
              background: 'transparent',
              color: 'rgba(255,255,255,0.5)',
              border: 'none',
              fontSize: 18,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>
      )}
      <style>{`@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }`}</style>
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
            fontSize: 13, fontWeight: 700,
            padding: '5px 14px', borderRadius: 50,
            letterSpacing: 1.2, textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            {isLive ? '🔴 AO VIVO AGORA' : '📅 14 e 15 de Março • 15h'}
          </div>
          <h1 style={{
            fontSize: 26, fontWeight: 800, lineHeight: 1.2, margin: '0 0 6px',
            textShadow: '0 2px 12px rgba(0,0,0,0.5)',
          }}>
            Live Shopping de<br />Calçados Ortopédicos
          </h1>
          <p style={{ fontSize: 15, opacity: 0.8, margin: 0, lineHeight: 1.5 }}>
            Chega de sentir dor nos pés! Oportunidade única para melhorar a saúde dos seus pés.
          </p>
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
          gap: 8, marginBottom: 16,
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
              borderRadius: 10, padding: '10px 12px',
              fontSize: 14, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
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
                height: 50, padding: '0 16px',
                fontSize: 16, outline: 'none',
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
                height: 50, padding: '0 16px',
                fontSize: 16, outline: 'none',
                width: '100%', boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: 'linear-gradient(135deg, #25D366, #128C7E)',
                color: '#fff', border: 'none', borderRadius: 12,
                height: 54, fontSize: 18, fontWeight: 700,
                cursor: 'pointer', width: '100%',
              }}
            >
              {submitting ? '⏳ Entrando...' : '💬 Entrar no Grupo VIP'}
            </button>
            <p style={{
              fontSize: 12, color: 'rgba(255,255,255,0.5)',
              textAlign: 'center', margin: '4px 0 0',
            }}>
              Entregamos para todo o Brasil 🇧🇷
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
