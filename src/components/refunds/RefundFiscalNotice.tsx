import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NewExchangePicker } from "@/components/pos/NewExchangePicker";
import { FinalizeExchangePicker } from "@/components/pos/FinalizeExchangePicker";
import type { RefundFiscalCheck } from "@/lib/refunds";

export function RefundFiscalNotice({ check, isAdmin, force, justification, onForce, onJustification, onRegistered }: {
  check: RefundFiscalCheck | null; isAdmin: boolean; force: boolean; justification: string;
  onForce: (value: boolean) => void; onJustification: (value: string) => void; onRegistered?: () => void;
}) {
  const [register, setRegister] = useState(false);
  const [confer, setConfer] = useState(false);
  if (!check) return null;
  return <>
    <div className="space-y-2 text-sm">
      {check.warning && <p className="text-destructive">{check.warning}</p>}
      {!check.allowed && <>
        <p className="text-destructive">{check.error}</p>
        {check.facts.sale_id && <Button variant="outline" onClick={() => setRegister(true)}>Registrar devolução agora</Button>}
        {check.facts.registered && <Button variant="outline" onClick={() => setConfer(true)}>Conferir devolução e NF-e</Button>}
        {!check.facts.sale_id && <p className="text-muted-foreground">Primeiro vincule este pedido à venda no PDV.</p>}
        {isAdmin && <>
          <label className="flex items-center gap-2"><input type="checkbox" checked={force} onChange={e => onForce(e.target.checked)} />Forçar estorno como administrador</label>
          {force && <label className="block">Justificativa obrigatória<Textarea aria-label="Justificativa da exceção fiscal" value={justification} maxLength={500} onChange={e => onJustification(e.target.value)} /></label>}
        </>}
      </>}
    </div>
    {register && check.facts.sale_id && <NewExchangePicker open initialSaleId={check.facts.sale_id} onCancel={() => setRegister(false)} onDone={() => { setRegister(false); setConfer(true); }} />}
    {confer && <FinalizeExchangePicker open onCancel={() => { setConfer(false); onRegistered?.(); }} onDone={() => { setConfer(false); onRegistered?.(); }} />}
  </>;
}