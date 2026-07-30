import { useCallback, useEffect, useRef, useState } from "react";

export interface WheelSegment {
  id: string;
  label: string;
  color: string;
}

interface Props {
  segments: WheelSegment[];
  /** Índice sorteado pelo servidor. Quando muda de null → número, a roleta gira. */
  targetIndex: number | null;
  onSpinEnd?: () => void;
  size?: number;
}

/**
 * Roleta colorida (canvas) que só anima — o sorteio é feito no servidor.
 */
export function PrizeWheelCanvas({ segments, targetIndex, onSpinEnd, size = 300 }: Props) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const center = size / 2;

  const draw = useCallback(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d");
      if (!ctx || segments.length === 0) return;
      ctx.clearRect(0, 0, size, size);
      const arc = (2 * Math.PI) / segments.length;

      segments.forEach((seg, i) => {
        const start = i * arc;
        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.arc(center, center, center - 6, start, start + arc);
        ctx.closePath();
        ctx.fillStyle = seg.color || "#FF6B00";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(start + arc / 2);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 4;
        const text = seg.label.length > 16 ? seg.label.slice(0, 15) + "…" : seg.label;
        ctx.fillText(text, center - 22, 0);
        ctx.restore();
      });

      // Miolo
      ctx.beginPath();
      ctx.arc(center, center, 26, 0, 2 * Math.PI);
      ctx.fillStyle = "#12121c";
      ctx.fill();
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = "#FFD700";
      ctx.font = "22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🎁", center, center + 1);
    },
    [segments, center, size],
  );

  const canvasCallback = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      if (node) draw(node);
    },
    [draw],
  );

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current);
  }, [draw]);

  useEffect(() => {
    if (targetIndex === null || !segments.length) return;
    const arc = 360 / segments.length;
    const segmentCenter = targetIndex * arc + arc / 2;
    const base = Math.ceil(rotation / 360) * 360;
    const target = base + 6 * 360 + (360 - segmentCenter - 90);
    setSpinning(true);
    setRotation(target);
    const t = window.setTimeout(() => {
      setSpinning(false);
      onSpinEnd?.();
    }, 4600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIndex]);

  if (!segments.length) return null;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
        <div className="w-0 h-0 border-l-[13px] border-l-transparent border-r-[13px] border-r-transparent border-t-[22px] border-t-yellow-400 drop-shadow-lg" />
      </div>
      <div
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? "transform 4.5s cubic-bezier(0.17,0.67,0.12,0.99)" : "none",
        }}
      >
        <canvas
          ref={canvasCallback}
          width={size}
          height={size}
          className="rounded-full shadow-2xl"
          style={{ filter: "drop-shadow(0 0 22px rgba(255,180,0,0.45))" }}
        />
      </div>
      {spinning && (
        <div
          className="absolute inset-0 rounded-full animate-pulse pointer-events-none"
          style={{ boxShadow: "0 0 45px rgba(255,215,0,0.45), 0 0 90px rgba(255,107,0,0.25)" }}
        />
      )}
    </div>
  );
}
