import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Clock, Gift, Truck, MessageCircle, ShieldCheck, ArrowRight, Sparkles } from "lucide-react";
import { initMetaPixel, trackPageView, trackPixelEvent } from "@/lib/metaPixel";

/* ── helpers ── */
const TARGET_DATE = new Date("2026-03-21T15:00:00-03:00"); // sábado 15h BRT

function useCountdown(target: Date) {
  const calc = useCallback(() => {
    const diff = Math.max(0, target.getTime() - Date.now());
    return {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
    };
  }, [target]);

  const [t, setT] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
  }, [calc]);
  return t;
}

const CountdownUnit = ({ value, label }: { value: number; label: string }) => (
  <div className="flex flex-col items-center">
    <span className="text-3xl sm:text-5xl font-black tabular-nums text-primary leading-none drop-shadow-[0_0_12px_hsl(var(--primary)/0.4)]">
      {String(value).padStart(2, "0")}
    </span>
    <span className="text-[10px] sm:text-xs uppercase tracking-widest text-white/40 mt-1">{label}</span>
  </div>
);

/* ── page ── */
export default function LiveOrtopedicosLP() {
  const [step, setStep] = useState(0); // 0=hero, 1=nome, 2=whatsapp, 3=done
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [saving, setSaving] = useState(false);
  const countdown = useCountdown(TARGET_DATE);

  // Meta Pixel
  useEffect(() => {
    initMetaPixel();
    trackPageView();
    trackPixelEvent('ViewContent', { content_name: 'Live Ortopédicos LP', content_category: 'landing_page' });
  }, []);

  const formatPhone = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  const saveLead = async () => {
    setSaving(true);
    try {
      const phone = whatsapp.replace(/\D/g, "");
      await supabase.from("lp_leads").insert({
        campaign_tag: "live-ortopedicos-marco-2026",
        name,
        phone: phone.length === 11 ? `55${phone}` : phone,
        source: "landing_page",
        metadata: { evento: "Live Ortopédicos", data: "2026-03-21 15h" } as any,
      });
      // Redirect directly to VIP group
      window.location.href = "https://sndflw.com/i/gMEAoOFehNzA95GpXQVK";
    } catch {
      toast.error("Erro ao salvar. Tente novamente.");
      setSaving(false);
    }
  };

  const phoneDigits = whatsapp.replace(/\D/g, "");

  /* ── shared wrapper ── */
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-[#0a0a0a] via-[#111111] to-[#0a0a0a] flex flex-col items-center justify-center px-4 py-8 selection:bg-primary/20 text-white">
      {/* ── STEP 0 — HERO ── */}
      {step === 0 && (
        <div className="w-full max-w-lg animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6 text-center">
          {/* badge */}
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary uppercase tracking-wider">
            <Sparkles className="h-3.5 w-3.5" /> Evento Exclusivo
          </div>

          <h1 className="text-3xl sm:text-4xl font-black leading-tight text-white">
            Live Shopping<br />
            <span className="text-primary">Calçados Ortopédicos</span>
          </h1>
          <p className="text-sm sm:text-base text-white/60 max-w-md mx-auto">
            Sábado às 15h — Lançamentos exclusivos com preços que você nunca viu. Cadastre-se e garanta acesso VIP.
          </p>

          {/* Countdown */}
          <div className="flex justify-center gap-4 sm:gap-6 py-4">
            <CountdownUnit value={countdown.days} label="Dias" />
            <span className="text-3xl sm:text-5xl font-black text-primary/30 self-start">:</span>
            <CountdownUnit value={countdown.hours} label="Horas" />
            <span className="text-3xl sm:text-5xl font-black text-primary/30 self-start">:</span>
            <CountdownUnit value={countdown.minutes} label="Min" />
            <span className="text-3xl sm:text-5xl font-black text-primary/30 self-start">:</span>
            <CountdownUnit value={countdown.seconds} label="Seg" />
          </div>

          {/* Benefits */}
          <div className="grid gap-3 text-left max-w-sm mx-auto">
            {[
              { icon: ShieldCheck, text: "Calçados ortopédicos a partir de R$ 139,99" },
              { icon: Truck, text: "Frete fixo R$ 19,99 para todo o Brasil" },
              { icon: MessageCircle, text: "Consultoria ao vivo para dores nos pés" },
              { icon: Gift, text: "Roleta de prêmios para quem pagar em até 20 min" },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm text-white/90 leading-snug">{text}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="space-y-2 pt-2">
            <Button size="lg" className="w-full max-w-sm text-base font-bold h-14 rounded-xl gap-2" onClick={() => setStep(1)}>
              Quero Participar <ArrowRight className="h-5 w-5" />
            </Button>
            <p className="text-[11px] text-white/40">
              Cadastro rápido — leva menos de 30 segundos
            </p>
          </div>
        </div>
      )}

      {/* ── STEP 1 — NOME ── */}
      {step === 1 && (
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-right-8 duration-400 space-y-6 text-center">
          {/* progress */}
          <div className="flex gap-1.5 justify-center">
            <div className="h-1.5 w-10 rounded-full bg-primary" />
            <div className="h-1.5 w-10 rounded-full bg-muted" />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white">Como podemos te chamar?</h2>
            <p className="text-sm text-white/60 mt-1">Informe seu primeiro nome</p>
          </div>

          <Input
            autoFocus
            placeholder="Seu primeiro nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
             className="h-14 text-center text-lg rounded-xl text-black bg-white placeholder:text-gray-400"
            onKeyDown={(e) => e.key === "Enter" && name.trim().length >= 2 && setStep(2)}
          />

          <Button
            size="lg"
            className="w-full h-14 rounded-xl text-base font-bold gap-2"
            disabled={name.trim().length < 2}
            onClick={() => setStep(2)}
          >
            Continuar <ArrowRight className="h-5 w-5" />
          </Button>
        </div>
      )}

      {/* ── STEP 2 — WHATSAPP ── */}
      {step === 2 && (
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-right-8 duration-400 space-y-6 text-center">
          <div className="flex gap-1.5 justify-center">
            <div className="h-1.5 w-10 rounded-full bg-primary" />
            <div className="h-1.5 w-10 rounded-full bg-primary" />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white">Olá, {name}! 👋</h2>
            <p className="text-sm text-white/60 mt-1">Agora informe seu WhatsApp para entrar no grupo VIP</p>
          </div>

          <Input
            autoFocus
            type="tel"
            placeholder="(00) 00000-0000"
            value={whatsapp}
            onChange={(e) => setWhatsapp(formatPhone(e.target.value))}
            className="h-14 text-center text-lg rounded-xl text-black bg-white placeholder:text-gray-400"
            onKeyDown={(e) => e.key === "Enter" && phoneDigits.length >= 10 && saveLead()}
          />

          <Button
            size="lg"
            className="w-full h-14 rounded-xl text-base font-bold gap-2"
            disabled={phoneDigits.length < 10 || saving}
            onClick={saveLead}
          >
            {saving ? "Entrando no grupo..." : "Finalizar Cadastro e Entrar no Grupo"} {!saving && <ArrowRight className="h-5 w-5" />}
          </Button>

          <button onClick={() => setStep(1)} className="text-xs text-white/40 hover:text-white transition">
            ← Voltar
          </button>
        </div>
      )}

      {/* ── STEP 3 — CONFIRMAÇÃO ── */}
      {step === 3 && (
        <div className="w-full max-w-sm animate-in fade-in zoom-in-95 duration-500 space-y-6 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-foreground">Cadastro Confirmado!</h2>
            <p className="text-sm text-muted-foreground mt-2">
              {name}, seu acesso VIP está garantido.<br />
              Agora entre no nosso grupo do WhatsApp para receber o link da live e ofertas exclusivas.
            </p>
          </div>

          {/* Countdown reminder */}
          <div className="flex justify-center gap-3 py-2">
            <Clock className="h-4 w-4 text-primary mt-0.5" />
            <span className="text-sm text-foreground">
              A live começa em{" "}
              <strong>
                {countdown.days > 0 ? `${countdown.days}d ` : ""}
                {countdown.hours}h {countdown.minutes}min
              </strong>
            </span>
          </div>

          <Button
            size="lg"
            className="w-full h-14 rounded-xl text-base font-bold gap-2 bg-[#25D366] hover:bg-[#1ebe57] text-white"
            onClick={() => window.open("https://sndflw.com/i/gMEAoOFehNzA95GpXQVK", "_blank")}
          >
            <MessageCircle className="h-5 w-5" /> Entrar no Grupo VIP
          </Button>

          <p className="text-[11px] text-muted-foreground">
            Nos vemos sábado às 15h! 🎉
          </p>
        </div>
      )}
    </div>
  );
}
