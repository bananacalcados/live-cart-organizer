import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, PartyPopper, Sparkles, X } from "lucide-react";
import { PrizeWheelCanvas, WheelSegment } from "./PrizeWheelCanvas";

export interface PublicWheel {
  id: string;
  name: string;
  audience: "payers" | "participants";
  min_purchase_value: number;
  require_otp: boolean;
  otp_verified: boolean;
  spins_used: number;
  max_spins: number;
  eligible: boolean;
  reason: string | null;
  segments: WheelSegment[];
}

async function api(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("event-prize-wheel", { body: payload });
  if (error) throw new Error(error.message);
  return data as any;
}

/** Busca as roletas ativas do evento corrente para um telefone. */
export function useEventPrizeWheels(phone?: string | null, eventId?: string | null) {
  const [wheels, setWheels] = useState<PublicWheel[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api({ action: "list", phone: phone || undefined, event_id: eventId || undefined });
      setWheels(res?.ok ? res.wheels || [] : []);
    } catch {
      setWheels([]);
    } finally {
      setLoading(false);
    }
  }, [phone, eventId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { wheels, loading, refresh };
}

interface Props {
  wheel: PublicWheel;
  phone: string;
  name?: string | null;
  onClose: () => void;
  onDone?: () => void;
}

const typeHint: Record<string, string> = {
  discount_percent: "Desconto aplicado automaticamente no seu próximo pedido.",
  discount_fixed: "Desconto aplicado automaticamente no seu próximo pedido.",
  free_shipping: "Frete grátis aplicado automaticamente no seu próximo pedido.",
  product: "Fale com a vendedora para retirar seu prêmio.",
  none: "Não foi dessa vez, mas continue participando!",
};

export function EventPrizeWheelDialog({ wheel, phone, name, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [prize, setPrize] = useState<any>(null);
  const [revealed, setRevealed] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");

  const doSpin = async () => {
    setBusy(true);
    try {
      const res = await api({ action: "spin", wheel_id: wheel.id, phone, name });
      if (!res?.ok) {
        if (res?.error === "otp_required") {
          setOtpOpen(true);
          return;
        }
        toast.error(res?.error || "Não foi possível girar");
        return;
      }
      setPrize(res.prize);
      setTargetIndex(res.index);
    } catch (e: any) {
      toast.error(e.message || "Erro ao girar");
    } finally {
      setBusy(false);
    }
  };

  const sendOtp = async () => {
    setBusy(true);
    try {
      const res = await api({ action: "send_otp", phone });
      if (res?.ok) {
        setOtpSent(true);
        toast.success("Código enviado no seu WhatsApp");
      } else toast.error(res?.error || "Falha ao enviar código");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setBusy(true);
    try {
      const res = await api({ action: "verify_otp", phone, code: otp });
      if (!res?.ok) {
        toast.error(res?.error || "Código inválido");
        return;
      }
      setOtpOpen(false);
      setOtp("");
      await doSpin();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 overflow-y-auto flex items-center justify-center p-4">
      <div className="relative w-full max-w-md rounded-3xl p-6 bg-gradient-to-b from-[#2a1a4a] via-[#1a1030] to-[#12081f] border-2 border-yellow-400/40 shadow-[0_0_60px_rgba(255,200,0,0.25)]">
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-4 top-4 text-white/60 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {!revealed ? (
          <div className="flex flex-col items-center gap-5">
            <div className="text-center space-y-1">
              <h3 className="text-2xl font-black bg-gradient-to-r from-yellow-300 via-orange-400 to-pink-500 bg-clip-text text-transparent flex items-center justify-center gap-2">
                <Sparkles className="h-6 w-6 text-yellow-300" /> {wheel.name}
              </h3>
              <p className="text-sm text-white/60">
                {wheel.audience === "payers"
                  ? "Roleta exclusiva de quem comprou neste evento"
                  : "Gire e ganhe um prêmio para usar na sua próxima compra"}
              </p>
            </div>

            <PrizeWheelCanvas
              segments={wheel.segments}
              targetIndex={targetIndex}
              onSpinEnd={() => setRevealed(true)}
              size={300}
            />

            {otpOpen ? (
              <div className="w-full space-y-3">
                <p className="text-center text-sm text-white/70">
                  Confirme seu WhatsApp para participar do sorteio.
                </p>
                {!otpSent ? (
                  <Button
                    onClick={sendOtp}
                    disabled={busy}
                    className="w-full h-14 text-base font-bold bg-gradient-to-r from-yellow-400 to-orange-500 text-black"
                  >
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "RECEBER CÓDIGO NO WHATSAPP"}
                  </Button>
                ) : (
                  <>
                    <Input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      inputMode="numeric"
                      placeholder="0000"
                      className="h-14 text-center text-2xl font-bold tracking-[0.5em] bg-white/10 text-white border-white/20"
                    />
                    <Button
                      onClick={verifyOtp}
                      disabled={otp.length < 4 || busy}
                      className="w-full h-14 text-base font-bold bg-gradient-to-r from-yellow-400 to-orange-500 text-black"
                    >
                      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "CONFIRMAR E GIRAR"}
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <Button
                onClick={doSpin}
                disabled={busy || targetIndex !== null || !wheel.eligible}
                className="h-16 px-10 text-lg font-black rounded-full bg-gradient-to-r from-yellow-400 via-orange-500 to-pink-500 text-white shadow-lg shadow-orange-500/40 hover:scale-105 transition-transform disabled:opacity-60"
              >
                {targetIndex !== null ? "🎰 Girando..." : busy ? "..." : "🎰 GIRAR A ROLETA"}
              </Button>
            )}

            {!wheel.eligible && wheel.reason && (
              <p className="text-xs text-center text-red-300">{wheel.reason}</p>
            )}
          </div>
        ) : (
          <div className="text-center space-y-4 py-2 animate-in fade-in zoom-in duration-500">
            <div className="relative">
              <div className="h-24 w-24 mx-auto rounded-full bg-gradient-to-br from-yellow-400 to-pink-500 flex items-center justify-center shadow-2xl">
                <PartyPopper className="h-12 w-12 text-white" />
              </div>
              <div className="absolute -top-1 -right-2 text-4xl animate-bounce">🎉</div>
              <div className="absolute -top-1 -left-2 text-3xl animate-bounce">✨</div>
            </div>
            <div>
              <h3 className="text-2xl font-black text-yellow-300">
                {prize?.prize_type === "none" ? "QUASE!" : "PARABÉNS!"}
              </h3>
              <p className="text-lg font-semibold text-white mt-1">{prize?.label}</p>
            </div>
            {prize?.coupon_code && (
              <div className="rounded-2xl bg-white/10 border-2 border-dashed border-yellow-400/50 p-4 space-y-1">
                <p className="text-[11px] uppercase tracking-wider text-white/60">Seu código</p>
                <p className="text-2xl font-mono font-black text-yellow-300 tracking-widest">
                  {prize.coupon_code}
                </p>
                {prize.expires_at && (
                  <p className="text-xs text-white/50">
                    Válido até {new Date(prize.expires_at).toLocaleDateString("pt-BR")}
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-white/60 max-w-xs mx-auto">
              {typeHint[prize?.prize_type as string] || ""}
            </p>
            <Button
              onClick={() => {
                onDone?.();
                onClose();
              }}
              className="w-full h-14 font-bold bg-gradient-to-r from-yellow-400 to-orange-500 text-black"
            >
              CONTINUAR
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
