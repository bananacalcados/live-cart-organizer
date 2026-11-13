import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { posSendText } from "@/lib/pos/posWhatsappSend";
import { centralLinkMessage, centralLinkUrl, type CentralLinkType } from "@/lib/central/staffLinkMessage";

type Option = {
  sale_id: string; order_ref: string; created_at: string; total: number | null; items: string | null;
  open_request: { id: string; type: string; status: string } | null;
  active_links: { id: string; type: string; created_at: string }[];
};

const label = (t: string) => (t === "troca" ? "Troca" : "Devolução");

/** Link de troca/devolução da Central gerado pela equipe dentro do chat. */
export function CentralLinkPanel({ phone, customerName, type, saleId, sendVia, selectedNumberId, onDone }: {
  phone: string; customerName?: string | null; type: CentralLinkType; saleId?: string;
  sendVia?: string | null; selectedNumberId?: string | null; onDone?: () => void;
}) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(saleId ?? null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("support_central_link_options" as any, { p_phone: phone });
    if (error) { toast.error("Não foi possível carregar os pedidos da cliente."); setOptions([]); return; }
    const list = (data as Option[]) || [];
    setOptions(list);
    setChosen((c) => c ?? (list.length === 1 ? list[0].sale_id : null));
  }, [phone]);
  useEffect(() => { void load(); }, [load]);

  const current = options?.find((o) => o.sale_id === chosen) ?? null;
  const sameTypeLink = current?.active_links.find((l) => l.type === type);

  async function generate() {
    if (!chosen) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("support_staff_central_link" as any, { p_sale_id: chosen, p_type: type, p_phone: phone });
      if (error) throw error;
      const r = data as { blocked?: boolean; token?: string; open_request?: { type: string; status: string } };
      if (r.blocked) { toast.info(`Já existe uma solicitação de ${label(r.open_request?.type || "")} aberta para este pedido.`); await load(); return; }
      if (!r.token) throw new Error("sem link");
      setMessage(centralLinkMessage(type, centralLinkUrl(type, r.token), customerName));
      await load();
    } catch { toast.error("Não foi possível gerar o link. Confira sua permissão e o pedido."); }
    finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(message); toast.success("Mensagem com link copiada."); }
    catch { toast.info("Selecione e copie a mensagem."); }
  }

  async function send() {
    if (!message) return;
    setBusy(true);
    try {
      const messageId = await posSendText({ provider: sendVia, phone, message, numberId: selectedNumberId });
      await supabase.from("whatsapp_messages").insert({ phone, message, direction: "outgoing", status: "sent", message_id: messageId, whatsapp_number_id: selectedNumberId || null });
      toast.success("Link enviado na conversa.");
      onDone?.();
    } catch (e) { toast.error("Falha ao enviar: " + (e instanceof Error ? e.message : "erro")); }
    finally { setBusy(false); }
  }

  if (!options) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando pedidos…</div>;

  return (
    <div className="space-y-3 p-3">
      <h3 className="text-sm font-semibold">Link de {label(type).toLowerCase()}</h3>
      {!options.length && <p className="text-sm text-muted-foreground">Nenhum pedido dos últimos 120 dias encontrado para este telefone.</p>}
      {!saleId && options.length > 1 && <p className="text-xs text-muted-foreground">Escolha o pedido:</p>}
      <div className="space-y-1.5">
        {options.filter((o) => !saleId || o.sale_id === saleId).map((o) => (
          <button key={o.sale_id} type="button" onClick={() => { setChosen(o.sale_id); setMessage(""); }}
            className={`w-full rounded-md border p-2 text-left text-xs ${chosen === o.sale_id ? "border-primary bg-primary/5" : ""}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">Pedido {o.order_ref}</span>
              <span className="text-muted-foreground">{new Date(o.created_at).toLocaleDateString("pt-BR")}</span>
              {o.open_request && <Badge variant="secondary">{label(o.open_request.type)} aberta · {o.open_request.status.replace(/_/g, " ")}</Badge>}
              {o.active_links.map((l) => <Badge key={l.id} variant="outline">Link de {label(l.type).toLowerCase()} ativo</Badge>)}
            </div>
            {o.items && <p className="mt-0.5 line-clamp-1 text-muted-foreground">{o.items}</p>}
          </button>
        ))}
      </div>
      {current?.open_request ? (
        <p className="text-xs text-muted-foreground">Este pedido já tem uma solicitação aberta. Acompanhe por ela em vez de criar outra.</p>
      ) : current && (
        <>
          {sameTypeLink && !message && <p className="text-xs text-muted-foreground">Já existe um link ativo, gerado em {new Date(sameTypeLink.created_at).toLocaleString("pt-BR")}. Por segurança o link antigo não pode ser exibido de novo; gerar um novo desativa o anterior.</p>}
          {!message && <Button size="sm" disabled={busy} onClick={generate}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : sameTypeLink ? <RefreshCw className="mr-1 h-4 w-4" /> : null}{sameTypeLink ? "Gerar novo link" : "Gerar link"}</Button>}
        </>
      )}
      {message && <>
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} aria-label="Mensagem pronta" className="break-all text-xs" />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={copy} disabled={busy}><Copy className="mr-1 h-4 w-4" />Copiar</Button>
          <Button size="sm" onClick={send} disabled={busy}><Send className="mr-1 h-4 w-4" />Enviar na conversa</Button>
        </div>
      </>}
    </div>
  );
}
