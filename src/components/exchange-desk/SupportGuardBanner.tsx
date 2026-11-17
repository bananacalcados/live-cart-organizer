import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { deskCall } from "./api";
import { supportGuardLines, type SupportGuardStatus } from "@/lib/exchangeDesk/supportGuard";

/** Aviso fixo das travas do suporte automático. 1 leitura ao abrir + 1 por minuto (só com a aba visível). */
export function SupportGuardBanner({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<SupportGuardStatus | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await deskCall<SupportGuardStatus>("support_guard_status");
      setStatus((cur) => JSON.stringify(cur) === JSON.stringify(next) ? cur : next);
    } catch { /* aviso nunca interrompe a tela */ }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);
  const lines = supportGuardLines(status);
  if (!lines.length) return null;
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive ${className}`}>
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <strong>Suporte automático com trava ativa</strong>
        {lines.map((l) => <p key={l}>{l}</p>)}
      </div>
    </div>
  );
}
