import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AD_NOTICE, advertisingChoice, saveAdvertisingChoice } from "@/lib/selfServiceAdvertising";
import { toast } from "sonner";

export function SelfServicePrivacy({ slug, inline = false }: { slug: string; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(!!advertisingChoice()?.accepted);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sync = () => setAccepted(!!advertisingChoice()?.accepted);
    window.addEventListener("storage", sync); window.addEventListener("selfservice-advertising-change", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("selfservice-advertising-change", sync); };
  }, []);
  const change = async (value: boolean) => {
    setBusy(true);
    try { await saveAdvertisingChoice(slug, value); setAccepted(value); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  };
  const choice = <label className="flex items-start gap-2 text-xs leading-relaxed"><Checkbox checked={accepted} disabled={busy} onCheckedChange={(v) => change(v === true)} aria-label="Autorizar publicidade e compartilhamento com a Meta" /><span>{AD_NOTICE}</span></label>;
  return <div className="space-y-2 text-xs text-muted-foreground">
    {inline && <><p>Seus dados serão usados para cadastro e atendimento do pedido.</p>{choice}</>}
    <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setOpen(true)}>Configurações de privacidade</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogTitle>Privacidade · Banana Calçados</DialogTitle><DialogDescription>Cadastro, pedidos e publicidade são finalidades separadas.</DialogDescription>
      <p className="text-sm">Usamos seus dados de cadastro para atender, entregar e acompanhar seu pedido. O CPF é usado no pedido e na documentação fiscal; não é enviado para publicidade neste fluxo.</p>
      <p className="text-sm">Com sua autorização opcional, compartilhamos com a Meta os dados descritos abaixo para medir compras e melhorar anúncios no Facebook e Instagram. Nome, contato, localização e identificador interno são protegidos por hash; isso não torna os dados anônimos. IP, navegador, FBC e FBP seguem no formato exigido pela plataforma.</p>
      {choice}
      <p className="text-sm">Guardamos a escolha, data, região e versão deste aviso. Desmarcar retira a autorização para novos envios; não impede compras e não apaga registros de aceites anteriores. Para pedidos ou contatos já cadastrados, solicite também a retirada pelo WhatsApp oficial. Dados já recebidos pela Meta seguem as políticas dela.</p>
    </DialogContent></Dialog>
  </div>;
}