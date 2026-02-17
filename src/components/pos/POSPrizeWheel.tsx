import { useState, useRef, useCallback } from "react";
import { Gift, Sparkles, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Segment {
  id: string;
  label: string;
  color: string;
  prize_type: string;
  prize_value: number;
  probability: number;
  expiry_days: number;
}

interface Props {
  segments: Segment[];
  storeId: string;
  customerPhone?: string;
  customerName?: string;
  customerEmail?: string;
  onPrizeAwarded?: (prize: { label: string; code: string; expires: string }) => void;
  onClose?: () => void;
}

function generateCouponCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "PR-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function pickSegmentByProbability(segments: Segment[]): number {
  const totalProb = segments.reduce((s, seg) => s + seg.probability, 0);
  let rand = Math.random() * totalProb;
  for (let i = 0; i < segments.length; i++) {
    rand -= segments[i].probability;
    if (rand <= 0) return i;
  }
  return segments.length - 1;
}

export function POSPrizeWheel({ segments, storeId, customerPhone, customerName, customerEmail, onPrizeAwarded, onClose }: Props) {
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ label: string; code: string; expires: string } | null>(null);
  const [rotation, setRotation] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const WHEEL_SIZE = 320;
  const CENTER = WHEEL_SIZE / 2;

  const drawWheel = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx || segments.length === 0) return;

    const arc = (2 * Math.PI) / segments.length;

    segments.forEach((seg, i) => {
      const startAngle = i * arc;
      const endAngle = startAngle + arc;

      // Segment fill
      ctx.beginPath();
      ctx.moveTo(CENTER, CENTER);
      ctx.arc(CENTER, CENTER, CENTER - 4, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();

      // Border
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Text
      ctx.save();
      ctx.translate(CENTER, CENTER);
      ctx.rotate(startAngle + arc / 2);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "right";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 3;
      const text = seg.label.length > 14 ? seg.label.slice(0, 13) + "…" : seg.label;
      ctx.fillText(text, CENTER - 20, 4);
      ctx.restore();
    });

    // Center circle
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 22, 0, 2 * Math.PI);
    ctx.fillStyle = "#1a1a2e";
    ctx.fill();
    ctx.strokeStyle = "#FFD700";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Center icon
    ctx.fillStyle = "#FFD700";
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🎁", CENTER, CENTER);
  }, [segments]);

  // Draw once on mount
  const canvasCallback = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      drawWheel(node);
      (canvasRef as any).current = node;
    }
  }, [drawWheel]);

  const spin = async () => {
    if (spinning || segments.length === 0) return;
    setSpinning(true);
    setResult(null);

    const winnerIdx = pickSegmentByProbability(segments);
    const winner = segments[winnerIdx];

    // Calculate target angle: align winner under pointer (top)
    const arc = 360 / segments.length;
    const segmentCenter = winnerIdx * arc + arc / 2;
    // Pointer at top = 270deg in canvas coords, we need to rotate so winner is there
    const targetAngle = 360 - segmentCenter - 90;
    const spins = 5 + Math.floor(Math.random() * 3); // 5-7 full rotations
    const totalRotation = spins * 360 + targetAngle + rotation;

    setRotation(totalRotation);

    // Wait for animation
    await new Promise(r => setTimeout(r, 4500));

    // Save prize
    const code = generateCouponCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + winner.expiry_days);

    if (customerPhone) {
      await supabase.from("customer_prizes").insert({
        customer_phone: customerPhone,
        customer_name: customerName || null,
        customer_email: customerEmail || null,
        store_id: storeId,
        segment_id: winner.id,
        prize_label: winner.label,
        prize_type: winner.prize_type,
        prize_value: winner.prize_value,
        coupon_code: code,
        expires_at: expiresAt.toISOString(),
        source: "wheel",
      } as any);
    }

    const prizeResult = {
      label: winner.label,
      code,
      expires: expiresAt.toLocaleDateString("pt-BR"),
    };

    setResult(prizeResult);
    setSpinning(false);
    onPrizeAwarded?.(prizeResult);
    toast.success(`🎉 Prêmio: ${winner.label}`);
  };

  if (segments.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {!result ? (
        <>
          <div className="text-center space-y-1">
            <h3 className="text-xl font-bold text-pos-orange flex items-center justify-center gap-2">
              <Sparkles className="h-5 w-5" /> Roleta de Prêmios
            </h3>
            <p className="text-sm text-pos-white/60">Gire a roleta e ganhe um prêmio para a próxima compra!</p>
          </div>

          {/* Wheel container */}
          <div className="relative">
            {/* Pointer triangle */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
              <div className="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-yellow-400 drop-shadow-lg" />
            </div>

            {/* Spinning wheel */}
            <div
              className="transition-transform ease-out"
              style={{
                transform: `rotate(${rotation}deg)`,
                transitionDuration: spinning ? "4s" : "0s",
                transitionTimingFunction: "cubic-bezier(0.17, 0.67, 0.12, 0.99)",
              }}
            >
              <canvas
                ref={canvasCallback}
                width={WHEEL_SIZE}
                height={WHEEL_SIZE}
                className="rounded-full shadow-2xl"
                style={{ filter: "drop-shadow(0 0 20px rgba(255, 107, 0, 0.3))" }}
              />
            </div>

            {/* Glow effect while spinning */}
            {spinning && (
              <div className="absolute inset-0 rounded-full animate-pulse"
                style={{ boxShadow: "0 0 40px rgba(255, 215, 0, 0.4), 0 0 80px rgba(255, 107, 0, 0.2)" }}
              />
            )}
          </div>

          <Button
            onClick={spin}
            disabled={spinning || !customerPhone}
            className="h-14 px-10 text-lg font-bold bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 text-white hover:from-yellow-500 hover:via-orange-600 hover:to-red-600 rounded-full shadow-lg shadow-orange-500/30 transition-all hover:scale-105 disabled:opacity-50"
          >
            {spinning ? (
              <span className="animate-pulse">🎰 Girando...</span>
            ) : (
              <>🎰 GIRAR ROLETA</>
            )}
          </Button>

          {!customerPhone && (
            <p className="text-xs text-red-400">Identifique o cliente para girar a roleta</p>
          )}
        </>
      ) : (
        <div className="text-center space-y-4 animate-in fade-in zoom-in duration-500">
          <div className="relative">
            <div className="h-24 w-24 mx-auto rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-2xl shadow-orange-500/40">
              <PartyPopper className="h-12 w-12 text-white" />
            </div>
            <div className="absolute -top-2 -right-2 text-4xl animate-bounce">🎉</div>
            <div className="absolute -top-2 -left-2 text-3xl animate-bounce delay-100">✨</div>
          </div>

          <div>
            <h3 className="text-2xl font-black text-pos-orange">PARABÉNS!</h3>
            <p className="text-lg text-pos-white font-semibold mt-1">{result.label}</p>
          </div>

          <div className="bg-pos-white/10 rounded-xl p-4 border-2 border-dashed border-yellow-400/50 space-y-2">
            <p className="text-xs text-pos-white/60 uppercase tracking-wider">Código do Prêmio</p>
            <p className="text-2xl font-mono font-black text-yellow-400 tracking-widest">{result.code}</p>
            <p className="text-xs text-pos-white/50">Válido até: {result.expires}</p>
          </div>

          <p className="text-xs text-pos-white/40 max-w-xs mx-auto">
            Apresente este código na sua próxima compra para resgatar o prêmio.
          </p>

          <Button
            onClick={onClose}
            className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold px-8"
          >
            <Gift className="h-4 w-4 mr-2" /> Fechar
          </Button>
        </div>
      )}
    </div>
  );
}
