import { useState, useRef } from "react";
import { ShoppingBag, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LiveLeadGateProps {
  onSubmit: (name: string, phone: string) => void;
  sessionTitle: string;
}

export function LiveLeadGate({ onSubmit, sessionTitle }: LiveLeadGateProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"form" | "verify">("form");
  const [code, setCode] = useState(["", "", "", ""]);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const rawPhone = phone.replace(/\D/g, "");
  const fullPhone = `55${rawPhone}`;
  const isValid = name.trim().length >= 2 && rawPhone.length >= 10;

  const startCooldown = () => {
    setCooldown(60);
    const interval = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const sendCode = async () => {
    if (!isValid) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("live-send-verification", {
        body: { phone: fullPhone },
      });
      if (error || !data?.success) throw new Error(data?.error || "Erro ao enviar código");
      setStep("verify");
      startCooldown();
      toast.success("Código enviado para seu WhatsApp!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Erro ao enviar código");
    } finally {
      setSending(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);

    if (digit && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-verify when all 4 digits entered
    if (digit && index === 3 && newCode.every(d => d)) {
      verifyCode(newCode.join(""));
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const verifyCode = async (codeStr: string) => {
    setVerifying(true);
    try {
      const { data, error } = await supabase
        .from("live_phone_verifications")
        .select("id, code, expires_at")
        .eq("phone", fullPhone)
        .eq("verified", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        toast.error("Código não encontrado. Solicite um novo.");
        setCode(["", "", "", ""]);
        setVerifying(false);
        return;
      }

      if (new Date(data.expires_at) < new Date()) {
        toast.error("Código expirado. Solicite um novo.");
        setCode(["", "", "", ""]);
        setVerifying(false);
        return;
      }

      if (data.code !== codeStr) {
        toast.error("Código incorreto. Tente novamente.");
        setCode(["", "", "", ""]);
        inputRefs.current[0]?.focus();
        setVerifying(false);
        return;
      }

      // Mark as verified
      await supabase
        .from("live_phone_verifications")
        .update({ verified: true })
        .eq("id", data.id);

      toast.success("WhatsApp verificado! ✅");
      onSubmit(name.trim(), fullPhone);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao verificar código");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-3">
          <img src="/images/banana-logo.png" alt="Banana Calçados" className="w-16 h-16 rounded-full mx-auto object-cover" />
          <div className="inline-flex items-center gap-1.5 bg-red-600/20 text-red-400 text-xs font-bold px-3 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            AO VIVO
          </div>
          <h1 className="text-xl font-bold">{sessionTitle}</h1>
          <p className="text-zinc-400 text-sm">
            {step === "form"
              ? "Cadastre-se para assistir, interagir no chat e aproveitar ofertas exclusivas! 🔥"
              : "Digite o código de 4 dígitos que enviamos no seu WhatsApp 📱"}
          </p>
        </div>

        {step === "form" ? (
          <form onSubmit={e => { e.preventDefault(); sendCode(); }} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-zinc-300 text-sm">Seu nome</Label>
              <Input
                placeholder="Maria Silva"
                value={name}
                onChange={e => setName(e.target.value)}
                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 h-12 text-[16px]"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300 text-sm">WhatsApp</Label>
              <Input
                placeholder="(11) 99999-9999"
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 h-12 text-[16px]"
                inputMode="tel"
              />
            </div>
            <Button
              type="submit"
              disabled={!isValid || sending}
              className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-bold text-base gap-2"
            >
              {sending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Enviando código...
                </>
              ) : (
                <>
                  <ShoppingBag className="w-5 h-5" />
                  Verificar WhatsApp
                </>
              )}
            </Button>
            <p className="text-zinc-600 text-[10px] text-center">
              Enviaremos um código de verificação no seu WhatsApp para confirmar o número.
            </p>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="bg-zinc-900 rounded-lg p-4 text-center">
              <p className="text-zinc-400 text-xs mb-1">Código enviado para</p>
              <p className="text-white font-medium">{phone}</p>
            </div>

            <div className="flex justify-center gap-3">
              {code.map((digit, i) => (
                <Input
                  key={i}
                  ref={el => { inputRefs.current[i] = el; }}
                  value={digit}
                  onChange={e => handleCodeChange(i, e.target.value)}
                  onKeyDown={e => handleCodeKeyDown(i, e)}
                  maxLength={1}
                  inputMode="numeric"
                  className="w-14 h-14 text-center text-2xl font-bold bg-zinc-900 border-zinc-700 text-white"
                  autoFocus={i === 0}
                  disabled={verifying}
                />
              ))}
            </div>

            {verifying && (
              <div className="flex items-center justify-center gap-2 text-amber-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Verificando...</span>
              </div>
            )}

            <div className="flex flex-col items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={cooldown > 0 || sending}
                onClick={sendCode}
                className="text-zinc-400 hover:text-white text-xs"
              >
                {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setStep("form"); setCode(["", "", "", ""]); }}
                className="text-zinc-500 hover:text-white text-xs"
              >
                ← Alterar número
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
