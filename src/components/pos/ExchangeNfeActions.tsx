import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { openFiscalDocument } from "@/lib/openFiscalDocument";
import { loadExchangeNfes, emitExchangeShippingNfe, type ExchangeNfeDoc } from "@/lib/pos/exchangeNfe";

/** Botões de nota fiscal de uma troca/devolução na tela de consulta. */
export function ExchangeNfeActions({ ev }: { ev: any }) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [devolucao, setDevolucao] = useState<ExchangeNfeDoc | null>(null);
  const [envio, setEnvio] = useState<ExchangeNfeDoc | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await loadExchangeNfes(ev);
      setDevolucao(r.devolucao); setEnvio(r.envio); setLoaded(true);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao buscar notas");
    } finally { setLoading(false); }
  };

  const open = async (d: ExchangeNfeDoc) => {
    if (!d.danfe_url) { toast.error("Nota sem arquivo disponível"); return; }
    try { await openFiscalDocument(d.danfe_url); } catch (e: any) { toast.error(e?.message); }
  };

  const emit = async () => {
    setEmitting(true);
    try {
      const d = await emitExchangeShippingNfe(ev);
      setEnvio(d);
      if ((d.status || "").toLowerCase().startsWith("autor")) toast.success("Nota de envio autorizada.");
      else toast.error(`Nota ${d.status}: ${d.rejection_message || ""}`, { duration: 12000 });
    } catch (e: any) {
      toast.error(e?.message || "Falha ao emitir nota de envio");
    } finally { setEmitting(false); }
  };

  const authorized = (d: ExchangeNfeDoc | null) => !!d && (d.status || "").toLowerCase().startsWith("autor");
  const canEmitEnvio = ev.tipo === "troca" && ev.status === "concluida" && !authorized(envio);

  if (!loaded) {
    return (
      <Button size="sm" variant="outline" onClick={load} disabled={loading}
        className="h-7 text-[11px] border-pos-white/20 text-pos-white/80 w-fit">
        {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />}
        Notas fiscais
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      {devolucao ? (
        <Button size="sm" variant="outline" onClick={() => open(devolucao)} disabled={!devolucao.danfe_url}
          className="h-7 text-[11px] border-pos-white/20 text-pos-white/80">
          <FileText className="h-3 w-3 mr-1" /> Nota de devolução ({devolucao.status})
        </Button>
      ) : <span className="text-pos-white/40">Sem nota de devolução</span>}
      {ev.tipo === "troca" && (envio ? (
        <Button size="sm" variant="outline" onClick={() => open(envio)} disabled={!envio.danfe_url}
          className="h-7 text-[11px] border-emerald-400/40 text-emerald-300">
          <FileText className="h-3 w-3 mr-1" /> Nota de envio ({envio.status})
        </Button>
      ) : <span className="text-pos-white/40">Sem nota de envio</span>)}
      {canEmitEnvio && (
        <Button size="sm" onClick={emit} disabled={emitting}
          className="h-7 text-[11px] bg-emerald-500 text-pos-black hover:bg-emerald-600">
          {emitting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />}
          {envio ? "Reemitir nota de envio" : "Emitir nota de envio"}
        </Button>
      )}
    </div>
  );
}
