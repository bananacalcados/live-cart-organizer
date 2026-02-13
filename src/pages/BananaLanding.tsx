import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const VIP_GROUP_LINK = "https://chat.whatsapp.com/SEU_LINK_AQUI"; // ← Substituir pelo link real

type Step = "welcome" | "name" | "whatsapp" | "confirm" | "done";

export default function BananaLanding() {
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if ((step === "name" || step === "whatsapp") && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 400);
      return () => clearTimeout(t);
    }
  }, [step, visible]);

  const formatWhatsApp = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const phone = whatsapp.replace(/\D/g, "");

      // Save to campaign_leads
      await supabase.from("campaign_leads").insert({
        campaign_id: "banana-verao-2025",
        name,
        phone,
        source: "landing_page_typebot",
        metadata: { event: "Nova Coleção Verão", dates: "19, 20, 21" } as any,
      });

      // Also save/update in customers table with tag
      const existing = await supabase
        .from("customers")
        .select("id, tags")
        .eq("whatsapp", phone)
        .maybeSingle();

      if (existing.data) {
        const tags = existing.data.tags || [];
        if (!tags.includes("lp-banana-verao")) {
          await supabase
            .from("customers")
            .update({ tags: [...tags, "lp-banana-verao"] })
            .eq("id", existing.data.id);
        }
      } else {
        await supabase.from("customers").insert({
          instagram_handle: `@lead_${phone}`,
          whatsapp: phone,
          tags: ["lp-banana-verao"],
        });
      }

      setStep("done");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao enviar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const containerCls =
    "min-h-screen flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden";
  const fadeCls = `transition-all duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`;

  return (
    <div
      className={containerCls}
      style={{
        background: "linear-gradient(160deg, #00BFA6 0%, #00897B 50%, #004D40 100%)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Background decorative circles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-white/5" />
        <div className="absolute bottom-10 -left-16 w-48 h-48 rounded-full bg-white/5" />
        <div className="absolute top-1/3 right-4 w-24 h-24 rounded-full bg-yellow-300/10" />
      </div>

      {/* Logo */}
      <div className="mb-4 relative z-10 text-center">
        <h2 className="text-2xl font-black text-white tracking-wider drop-shadow-lg" style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
          🍌 BANANA
        </h2>
        <p className="text-xs font-bold text-white/80 tracking-[0.3em] -mt-1">CALÇADOS</p>
      </div>

      {/* Card */}
      <div className={`relative z-10 w-full max-w-sm ${fadeCls}`}>
        <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden">
          {/* Progress dots */}
          <div className="flex justify-center gap-2 pt-5 pb-2">
            {(["welcome", "name", "whatsapp", "confirm"] as Step[]).map((s, i) => (
              <div
                key={s}
                className={`h-2 rounded-full transition-all duration-300 ${
                  (["welcome", "name", "whatsapp", "confirm", "done"] as Step[]).indexOf(step) >= i
                    ? "w-8 bg-emerald-500"
                    : "w-2 bg-gray-200"
                }`}
              />
            ))}
          </div>

          <div className="px-6 pb-8 pt-2 min-h-[320px] flex flex-col justify-between">
            {/* STEP: Welcome */}
            {step === "welcome" && (
              <div className="flex flex-col items-center text-center gap-4 flex-1 justify-center">
                <div className="w-full h-52 rounded-2xl overflow-hidden shadow-md">
                  <img
                    src="/images/banana-modelo.jpg"
                    alt="Nova Coleção Verão"
                    className="w-full h-full object-cover object-center"
                    loading="eager"
                  />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-800 leading-tight">
                    Nova Coleção<br />
                    <span className="text-emerald-600">Verão com Conforto</span> 🌴
                  </h1>
                  <p className="text-sm text-gray-500 mt-2">
                    Dias <strong>19, 20 e 21</strong> — Ofertas exclusivas nos Grupos VIP!
                  </p>
                </div>
                <button
                  onClick={() => setStep("name")}
                  className="w-full py-3.5 rounded-xl font-bold text-white text-lg shadow-lg active:scale-95 transition-transform"
                  style={{ background: "linear-gradient(135deg, #00BFA6, #00897B)" }}
                >
                  Quero participar! 🎉
                </button>
              </div>
            )}

            {/* STEP: Name */}
            {step === "name" && (
              <div className="flex flex-col gap-4 flex-1 justify-center">
                <div className="text-center">
                  <span className="text-3xl">👋</span>
                  <h2 className="text-xl font-bold text-gray-800 mt-2">
                    Como posso te chamar?
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Pra gente personalizar sua experiência
                  </p>
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Seu nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep("whatsapp")}
                  className="w-full px-4 py-3.5 rounded-xl border-2 border-gray-200 focus:border-emerald-400 focus:ring-0 outline-none text-lg text-gray-800 placeholder:text-gray-300 transition-colors"
                  autoComplete="given-name"
                />
                <button
                  onClick={() => name.trim() && setStep("whatsapp")}
                  disabled={!name.trim()}
                  className="w-full py-3.5 rounded-xl font-bold text-white text-lg shadow-lg active:scale-95 transition-all disabled:opacity-40 disabled:scale-100"
                  style={{ background: name.trim() ? "linear-gradient(135deg, #00BFA6, #00897B)" : "#ccc" }}
                >
                  Continuar →
                </button>
              </div>
            )}

            {/* STEP: WhatsApp */}
            {step === "whatsapp" && (
              <div className="flex flex-col gap-4 flex-1 justify-center">
                <div className="text-center">
                  <span className="text-3xl">📱</span>
                  <h2 className="text-xl font-bold text-gray-800 mt-2">
                    Qual seu WhatsApp, {name.split(" ")[0]}?
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Pra te adicionar no Grupo VIP exclusivo
                  </p>
                </div>
                <input
                  ref={inputRef}
                  type="tel"
                  inputMode="numeric"
                  placeholder="(00) 00000-0000"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(formatWhatsApp(e.target.value))}
                  onKeyDown={(e) =>
                    e.key === "Enter" && whatsapp.replace(/\D/g, "").length >= 10 && setStep("confirm")
                  }
                  className="w-full px-4 py-3.5 rounded-xl border-2 border-gray-200 focus:border-emerald-400 focus:ring-0 outline-none text-lg text-gray-800 placeholder:text-gray-300 transition-colors text-center tracking-wider"
                  autoComplete="tel"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setStep("name")}
                    className="px-4 py-3.5 rounded-xl font-semibold text-gray-500 border-2 border-gray-200 active:scale-95 transition-transform"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => whatsapp.replace(/\D/g, "").length >= 10 && setStep("confirm")}
                    disabled={whatsapp.replace(/\D/g, "").length < 10}
                    className="flex-1 py-3.5 rounded-xl font-bold text-white text-lg shadow-lg active:scale-95 transition-all disabled:opacity-40 disabled:scale-100"
                    style={{
                      background:
                        whatsapp.replace(/\D/g, "").length >= 10
                          ? "linear-gradient(135deg, #00BFA6, #00897B)"
                          : "#ccc",
                    }}
                  >
                    Continuar →
                  </button>
                </div>
              </div>
            )}

            {/* STEP: Confirm */}
            {step === "confirm" && (
              <div className="flex flex-col gap-4 flex-1 justify-center">
                <div className="text-center">
                  <span className="text-3xl">✅</span>
                  <h2 className="text-xl font-bold text-gray-800 mt-2">
                    Tudo certo, {name.split(" ")[0]}?
                  </h2>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Nome</span>
                    <span className="font-semibold text-gray-800">{name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">WhatsApp</span>
                    <span className="font-semibold text-gray-800">{whatsapp}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStep("whatsapp")}
                    className="px-4 py-3.5 rounded-xl font-semibold text-gray-500 border-2 border-gray-200 active:scale-95 transition-transform"
                  >
                    ←
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-1 py-3.5 rounded-xl font-bold text-white text-lg shadow-lg active:scale-95 transition-transform disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, #00BFA6, #00897B)" }}
                  >
                    {submitting ? "Enviando..." : "Confirmar 🚀"}
                  </button>
                </div>
              </div>
            )}

            {/* STEP: Done */}
            {step === "done" && (
              <div className="flex flex-col items-center text-center gap-5 flex-1 justify-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <span className="text-3xl">🎉</span>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">
                    Você tá dentro, {name.split(" ")[0]}!
                  </h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Clique abaixo para entrar no Grupo VIP e garantir suas ofertas exclusivas!
                  </p>
                </div>
                <a
                  href={VIP_GROUP_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3.5 rounded-xl font-bold text-white text-lg shadow-lg active:scale-95 transition-transform text-center flex items-center justify-center gap-2"
                  style={{ background: "#25D366" }}
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.11.546 4.093 1.504 5.82L0 24l6.335-1.652A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.82c-1.89 0-3.64-.5-5.16-1.387l-.37-.22-3.84 1.007 1.024-3.742-.24-.382A9.77 9.77 0 012.18 12c0-5.422 4.398-9.82 9.82-9.82 5.422 0 9.82 4.398 9.82 9.82 0 5.422-4.398 9.82-9.82 9.82z"/>
                  </svg>
                  Entrar no Grupo VIP
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="text-white/50 text-xs mt-6 relative z-10">
        © 2025 Banana Calçados
      </p>
    </div>
  );
}
