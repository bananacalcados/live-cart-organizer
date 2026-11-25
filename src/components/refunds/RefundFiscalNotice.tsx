import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NewExchangePicker } from "@/components/pos/NewExchangePicker";
import { FinalizeExchangePicker } from "@/components/pos/FinalizeExchangePicker";
import { CancelFiscalDocDialog } from "@/components/fiscal/CancelFiscalDocDialog";
import { supabase } from "@/integrations/supabase/client";
import { emitirNfeDevolucao } from "@/lib/pos/finalizeExchange";
import type { RefundFiscalCheck } from "@/lib/refunds";

const OPEN_STATUSES = ["iniciada", "aguardando_retorno", "recebido_conferencia", "aguardando_envio"] as const;

export function RefundFiscalNotice({ check, isAdmin, force, justification, onForce, onJustification, onRegistered }: {
  check: RefundFiscalCheck | null; isAdmin: boolean; force: boolean; justification: string;
  onForce: (value: boolean) => void; onJustification: (value: string) => void; onRegistered?: () => void;
}) {
  const [register, setRegister] = useState(false);
  const [confer, setConfer] = useState(false);
  const [cancelNote, setCancelNote] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  if (!check) return null;

  const emitReturnNfe = async () => {
    const saleId = check.facts.sale_id;
    if (!saleId) return;
    setEmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const { data: rows, error } = await supabase
        .from("trocas_devolucoes")
        .select("id, codigo_devolucao")
        .eq("pedido_original_id", saleId)
        .in("status", [...OPEN_STATUSES])
        .order("created_at", { ascending: false })
        .limit(2);
      if (error) throw error;
      if (!rows?.length) throw new Error("Não encontrei uma devolução aberta para emitir a nota. Abra a finalização para conferir.");
      if (rows.length > 1) throw new Error("Há mais de uma devolução aberta nesta venda. Abra a finalização e escolha a correta antes de emitir.");
      const result = await emitirNfeDevolucao(rows[0].id);
      if (result.status === "authorized") setActionSuccess("NF-e de devolução autorizada e vinculada. Agora o estorno já pode ser revisado.");
      else if (result.status === "pending_sefaz") setActionSuccess("A SEFAZ está indisponível; a NF-e ficou em emissão e o estorno já pode ser revisado.");
      else if (result.status === "skipped") setActionSuccess("A venda não tem nota original; a conferência foi atualizada.");
      else throw new Error(result.error || "A NF-e não foi autorizada. Confira o motivo e tente novamente.");
      onRegistered?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Não foi possível emitir a NF-e de devolução.");
    } finally {
      setEmitting(false);
    }
  };

  return <>
    <div className="space-y-2 text-sm">
      {check.warning && <p className="text-destructive">{check.warning}</p>}
      {actionSuccess && <p className="text-emerald-500">{actionSuccess}</p>}
      {actionError && <p className="text-destructive">{actionError}</p>}
      {!check.allowed && <>
        <p className="text-destructive">{check.error}</p>
        {check.step === "cancelar_nota" && check.facts.sale_note_id && <div className="rounded-md border border-border p-3 space-y-2">
          <p className="font-medium">Cancelamento antes do envio — passo a passo</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Cancelar a nota de venda{check.facts.sale_note_numero ? ` nº ${check.facts.sale_note_numero}` : ""} (ainda dentro do prazo).</li>
            <li>Voltar aqui e confirmar o estorno.</li>
          </ol>
          <Button variant="outline" onClick={() => setCancelNote(true)}>1. Cancelar a nota de venda</Button>
        </div>}
        {(!check.step || check.step === "devolucao") && check.facts.sale_id && !check.facts.registered && <Button variant="outline" onClick={() => setRegister(true)}>Registrar devolução agora</Button>}
        {(!check.step || check.step === "devolucao") && check.facts.registered && <Button variant="outline" onClick={() => setConfer(true)}>Finalizar troca/devolução</Button>}
        {(!check.step || check.step === "devolucao") && check.facts.registered && check.facts.received && !check.facts.return_note_ready && <Button variant="outline" disabled={emitting} onClick={() => void emitReturnNfe()}>
          {emitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {emitting ? "Emitindo NF-e…" : "Emitir NF-e de devolução"}
        </Button>}
        {!check.facts.sale_id && <p className="text-muted-foreground">Primeiro vincule este pedido à venda no PDV.</p>}
        {isAdmin && <>
          <label className="flex items-center gap-2"><input type="checkbox" checked={force} onChange={e => onForce(e.target.checked)} />Forçar estorno como administrador</label>
          {force && <label className="block">Justificativa obrigatória<Textarea aria-label="Justificativa da exceção fiscal" value={justification} maxLength={500} onChange={e => onJustification(e.target.value)} /></label>}
        </>}
      </>}
    </div>
    {register && check.facts.sale_id && <NewExchangePicker open initialSaleId={check.facts.sale_id} onCancel={() => setRegister(false)} onDone={() => { setRegister(false); setConfer(true); }} />}
    {cancelNote && check.facts.sale_note_id && <CancelFiscalDocDialog open onOpenChange={setCancelNote} fiscalDocumentId={check.facts.sale_note_id} modelo={Number(check.facts.sale_note_modelo || 55)} numero={check.facts.sale_note_numero ?? undefined} onCancelled={() => { setCancelNote(false); onRegistered?.(); }} />}
    {confer && check.facts.sale_id && <FinalizeExchangePicker open initialSaleId={check.facts.sale_id} onCancel={() => { setConfer(false); onRegistered?.(); }} onDone={() => { setConfer(false); onRegistered?.(); }} />}
  </>;
}
