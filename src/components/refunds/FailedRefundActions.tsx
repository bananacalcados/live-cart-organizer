import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Search, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { refundApi } from "@/lib/refunds";

/** Estorno com falha: consultar o gateway e, se não houver estorno lá, tentar de novo. */
export function FailedRefundActions({ refundId, onChanged }: { refundId: string; onChanged?: () => void }) {
  const [busy, setBusy] = useState<"check" | "retry" | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  const check = async () => {
    setBusy("check");
    try {
      const r = await refundApi.checkGateway(refundId);
      setInfo(r.message);
      setCanRetry(!!r.can_retry);
      if (r.refunded) { toast.success(r.message); onChanged?.(); }
    } catch (e: any) { toast.error(e?.message || "Falha ao consultar o gateway."); }
    finally { setBusy(null); }
  };

  const retry = async () => {
    if (!confirm("Tentar o estorno de novo no gateway? O sistema confere antes que ele ainda não foi feito.")) return;
    setBusy("retry");
    try {
      const r = await refundApi.retry(refundId);
      if (r.ok) toast.success(r.message || "Nova tentativa enviada."); else toast.error(r.error || r.message || "O gateway recusou de novo.");
      onChanged?.();
    } catch (e: any) { toast.error(e?.message || "Falha ao tentar de novo."); onChanged?.(); }
    finally { setBusy(null); }
  };

  return (
    <div className="flex max-w-xs flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={check}>
          {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Verificar no gateway
        </Button>
        <Button size="sm" disabled={!!busy || !canRetry} onClick={retry} title={canRetry ? "" : "Verifique no gateway primeiro"}>
          {busy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Tentar de novo
        </Button>
      </div>
      {info && <p className="text-right text-[11px] text-muted-foreground">{info}</p>}
    </div>
  );
}
