import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { initMetaPixel, trackPageView, trackPixelEvent } from "@/lib/metaPixel";

const LIVE_DATE = new Date("2026-04-18T15:00:00-03:00");
const CAMPAIGN_TAG = "live-ortopedicos-abril-2026";
const VIP_LINK = "https://checkout.bananacalcados.com.br/vip/liveconsumidor";

function useCountdown(target: Date) {
  const calc = useCallback(() => {
    const diff = Math.max(0, target.getTime() - Date.now());
    return {
      d: Math.floor(diff / 86400000),
      h: Math.floor((diff % 86400000) / 3600000),
      m: Math.floor((diff % 3600000) / 60000),
      s: Math.floor((diff % 60000) / 1000),
      isLive: diff <= 0,
    };
  }, [target]);
  const [t, setT] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
  }, [calc]);
  return t;
}

const formatPhone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export default function LiveOrtopedicosAbrilLP() {
  const { d, h, m, s, isLive } = useCountdown(LIVE_DATE);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    initMetaPixel();
    trackPageView();
    trackPixelEvent("ViewContent", { content_name: "Live Ortopédicos Abril", content_category: "landing_page" });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimName = name.trim();
    const digits = phone.replace(/\D/g, "");
    if (!trimName || digits.length < 10 || submitting) return;
    setSubmitting(true);

    // Save lead to lp_leads (goes to Marketing > Leads)
    await supabase.from("lp_leads").insert({
      campaign_tag: CAMPAIGN_TAG,
      name: trimName,
      phone: digits.length === 11 ? `55${digits}` : digits,
      source: "landing_page",
      metadata: { evento: "Live Ortopédicos Bonitos", data: "2026-04-18 15h", origem: "lp-ortopedicos-abril" } as any,
    });

    // Fire Meta Pixel events BEFORE redirect
    trackPixelEvent("Lead", { content_name: "Live Ortopédicos Abril", content_category: "vip_group" });
    trackPixelEvent("CompleteRegistration", { content_name: "Grupo VIP Live Ortopédicos Abril", value: 0, currency: "BRL" });

    setSubmitted(true);

    // Redirect to VIP group after brief delay
    setTimeout(() => {
      window.location.href = VIP_LINK;
    }, 800);
  };

  const CD = ({ v, l }: { v: number; l: string }) => (
    <div style={{ textAlign: "center" }}>
      <div style={{
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)",
        borderRadius: 10, width: 58, height: 52,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px solid rgba(255,255,255,0.12)",
      }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
          {String(v).padStart(2, "0")}
        </span>
      </div>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", letterSpacing: 1, textTransform: "uppercase", marginTop: 2, display: "block" }}>
        {l}
      </span>
    </div>
  );

  return (
    <div style={{
      minHeight: "100dvh", position: "relative",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: "#fff", overflow: "hidden",
    }}>
      {/* Background image */}
      <img
        src="/images/live-ortopedicos-abril.webp"
        alt="Calçados Ortopédicos Bonitos"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
      {/* Gradient overlay */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.4) 30%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0.95) 100%)",
      }} />

      {/* Content */}
      <div style={{
        position: "relative", zIndex: 1, minHeight: "100dvh",
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
        padding: "0 20px 28px", maxWidth: 480, margin: "0 auto",
      }}>
        {/* Badge */}
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <span style={{
            display: "inline-block", background: isLive ? "#e53e3e" : "linear-gradient(135deg, #d4a054, #b8860b)",
            fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 50,
            letterSpacing: 1.2, textTransform: "uppercase",
          }}>
            {isLive ? "🔴 AO VIVO AGORA" : "📅 Sábado, 18 de Abril • 15h"}
          </span>
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: 24, fontWeight: 800, lineHeight: 1.2, margin: "0 0 6px",
          textAlign: "center", textShadow: "0 2px 12px rgba(0,0,0,0.5)",
        }}>
          Live Shopping de Calçados<br />Ortopédicos Bonitos 👟
        </h1>
        <p style={{ fontSize: 14, opacity: 0.8, margin: "0 0 12px", textAlign: "center", lineHeight: 1.5 }}>
          Cadastre-se e receba o link da live com ofertas exclusivas. Ficaremos AO VIVO a partir das 15h!
        </p>

        {/* Countdown */}
        {!isLive && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 14 }}>
            <CD v={d} l="Dias" /><CD v={h} l="Hrs" /><CD v={m} l="Min" /><CD v={s} l="Seg" />
          </div>
        )}

        {/* Benefits */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
          {[
            { emoji: "💰", text: "De R$ 99,99 a R$ 299,99" },
            { emoji: "🚚", text: "Frete R$ 9,99 Sudeste" },
            { emoji: "💳", text: "6x s/ juros ou 5% no PIX" },
            { emoji: "🔄", text: "7 dias p/ troca e devolução" },
          ].map((b, i) => (
            <div key={i} style={{
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10, padding: "8px 10px", fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ fontSize: 16 }}>{b.emoji}</span> {b.text}
            </div>
          ))}
        </div>

        {/* Extra info */}
        <p style={{ fontSize: 11, opacity: 0.5, textAlign: "center", margin: "0 0 10px" }}>
          📍 Banana Calçados — Gov. Valadares, MG · Frete fixo R$ 9,99 para MG, SP, RJ e ES
        </p>

        {/* Form or success */}
        {submitted ? (
          <div style={{
            background: "rgba(56,161,105,0.2)", border: "1px solid rgba(56,161,105,0.4)",
            borderRadius: 12, padding: "16px", textAlign: "center",
          }}>
            <span style={{ fontSize: 32 }}>✅</span>
            <p style={{ fontSize: 14, fontWeight: 700, margin: "8px 0 0" }}>
              Cadastro feito! Entrando no grupo VIP... 💬
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              placeholder="Seu primeiro nome"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoComplete="given-name"
              style={{
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)",
                color: "#fff", borderRadius: 10, height: 48, padding: "0 16px",
                fontSize: 16, outline: "none", width: "100%", boxSizing: "border-box",
              }}
            />
            <input
              placeholder="WhatsApp (com DDD)"
              value={phone}
              onChange={e => setPhone(formatPhone(e.target.value))}
              required
              type="tel"
              autoComplete="tel"
              style={{
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)",
                color: "#fff", borderRadius: 10, height: 48, padding: "0 16px",
                fontSize: 16, outline: "none", width: "100%", boxSizing: "border-box",
              }}
            />
            <button
              type="submit"
              disabled={submitting || name.trim().length < 2 || phone.replace(/\D/g, "").length < 10}
              style={{
                background: submitting ? "#888" : "linear-gradient(135deg, #25D366, #128C7E)",
                color: "#fff", border: "none", borderRadius: 12,
                height: 52, fontSize: 17, fontWeight: 700,
                cursor: submitting ? "default" : "pointer", width: "100%",
                opacity: (name.trim().length < 2 || phone.replace(/\D/g, "").length < 10) ? 0.5 : 1,
              }}
            >
              {submitting ? "⏳ Entrando..." : "💬 Cadastrar e Entrar no Grupo VIP"}
            </button>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", textAlign: "center", margin: "2px 0 0" }}>
              Cadastro rápido — leva menos de 30 segundos
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
