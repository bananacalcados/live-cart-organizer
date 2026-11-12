import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { deskCall } from "./api";
import { supportAiFailureAlert } from "@/lib/exchangeDesk/supportHealth";

type Health = { total: number; failed: number; failure_rate: number; alert: boolean };

export function SupportAiHealthAlert() {
  const [health, setHealth] = useState<Health | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await deskCall<Health>("support_ai_health_1h");
      setHealth((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    } catch {
      // O aviso nunca interrompe a operação da Expedição.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!health || !supportAiFailureAlert(health.total, health.failed)) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span><strong>Atenção:</strong> {health.failed} de {health.total} chamadas da IA falharam na última hora ({health.failure_rate}%). As novas tentativas e a fila humana continuam disponíveis.</span>
    </div>
  );
}
