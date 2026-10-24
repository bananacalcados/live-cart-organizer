import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AD_NOTICE, advertisingChoice, saveAdvertisingChoice } from "@/lib/selfServiceAdvertising";
import { toast } from "sonner";

type State = "default" | "accepted" | "refused";
const read = (): State => { const c = advertisingChoice(); return !c ? "default" : c.accepted ? "accepted" : "refused"; };

/** Só um link discreto "Configurações de privacidade"; nenhuma caixinha no caminho da compra. */
export function SelfServicePrivacy({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>(read);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sync = () => setState(read());
    window.addEventListener("storage", sync); window.addEventListener("selfservice-advertising-change", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("selfservice-advertising-change", sync); };
  }, []);
  const change = async (value: boolean) => {
    setBusy(true);
    try { await saveAdvertisingChoice(slug, value); setState(value ? "accepted" : "refused"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  };
  return <div className="text-center text-xs text-muted-foreground">
    <Button variant="link" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => setOpen(true)}>Configurações de privacidade</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto text-left"><DialogTitle>Privacidade · Banana Calçados</DialogTitle><DialogDescription>Como usamos seus dados neste link.</DialogDescription>
      <p className="text-sm">Usamos seus dados de cadastro para atender, entregar e acompanhar seu pedido. O CPF é usado no pedido e na nota fiscal; não é enviado para publicidade.</p>
      <p className="text-sm">Para medir se nossos anúncios no Facebook e Instagram geram vendas, compartilhamos com a Meta o clique no anúncio, IP, navegador e o valor da compra. Você pode recusar abaixo; isso não impede seu cadastro nem sua compra.</p>
      <label className="flex items-start gap-2 text-sm"><Checkbox checked={state === "refused"} disabled={busy} onCheckedChange={(v) => change(v !== true)} aria-label="Não usar meus dados para anúncios" /><span>Não quero que meus dados sejam usados para anúncios.</span></label>
      {state !== "refused" && <label className="flex items-start gap-2 text-sm"><Checkbox checked={state === "accepted"} disabled={busy} onCheckedChange={(v) => change(v === true)} aria-label="Autorizar dados pessoais para a Meta" /><span>{AD_NOTICE}</span></label>}
      <p className="text-sm">Guardamos sua escolha e a data. Você pode mudar quando quiser por aqui ou pedir a retirada dos seus dados pelo nosso WhatsApp oficial. Dados já recebidos pela Meta seguem as políticas dela.</p>
    </DialogContent></Dialog>
  </div>;
}
