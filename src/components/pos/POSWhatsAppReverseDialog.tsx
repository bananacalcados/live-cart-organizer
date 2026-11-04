import { useEffect, useMemo, useState } from "react";
import { Loader2, PackageOpen, Send, Printer, Copy, XCircle } from "lucide-react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { EmbeddedDialog, EmbeddedDialogContent } from "@/components/chat/EmbeddedDialog";
import { posSendText, posSendMedia, type PosSendProvider } from "@/lib/pos/posWhatsappSend";
import { loadKnownCustomerByPhone } from "@/lib/posCustomerResolve";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  customerName?: string;
  sendVia: PosSendProvider;
  selectedNumberId: string | null;
  embedded?: boolean;
}

interface ReverseItem {
  id: string; created_at: string; customer_name: string; servico_nome: string | null; valid_until: string | null;
  status: string; codigo_objeto: string | null; label_url: string | null; error_message: string | null; sent_at: string | null; reason: string | null;
}

const SERVICES = [
  { code: "03301", label: "PAC Reverso" },
  { code: "03247", label: "SEDEX Reverso" },
];
const STATUS: Record<string, string> = { criada: "Criada", rotulo_emitido: "Pronta", postada: "Postada", entregue: "Entregue", cancelada: "Cancelada", erro: "Erro" };
const brDate = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
/** Verdadeiro quando o prazo de 7 dias já passou e o pacote ainda não foi postado. */
const expired = (it: ReverseItem) =>
  !!it.valid_until && !["postada", "entregue", "cancelada"].includes(it.status) &&
  new Date(`${it.valid_until}T23:59:59-03:00`).getTime() < Date.now();

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("correios-reverse", { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const REVERSE_VALID_DAYS = 7;

export function reverseWhatsAppText(firstName: string, code: string, service: string, validUntil: string) {
  const hi = firstName ? `Oi, ${firstName}!` : "Oi!";
  return `${hi} Sua etiqueta de devolução pelos Correios está pronta 📦\n\nCódigo de postagem: *${code}*\nServiço: ${service}\nVálido até: ${validUntil}\n\n⚠️ Atenção: esse código só vale até essa data. Se não postar até lá, é preciso pedir uma nova etiqueta.\n\nÉ só levar o pacote bem fechado a qualquer agência dos Correios e informar esse código. Você não paga nada pelo envio.`;
}

export function POSWhatsAppReverseDialog({ open, onOpenChange, phone, customerName, sendVia, selectedNumberId, embedded = false }: Props) {
  const [form, setForm] = useState({ nome: customerName || "", cpf: "", email: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "" });
  const [service, setService] = useState("03301");
  const [peso, setPeso] = useState("1000");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [items, setItems] = useState<ReverseItem[]>([]);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open || !phone) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [known, list] = await Promise.all([
          loadKnownCustomerByPhone(phone, null).catch(() => null),
          call({ action: "list", phone }).catch(() => ({ items: [] })),
        ]);
        if (!alive) return;
        if (known) setForm((f) => ({
          nome: f.nome || known.name || "", cpf: known.cpf || "", email: known.email || "", cep: known.cep || "", logradouro: known.address || "",
          numero: known.address_number || "", complemento: known.complement || "", bairro: known.neighborhood || "", cidade: known.city || "", uf: (known.state || "").slice(0, 2).toUpperCase(),
        }));
        setItems(list.items || []);
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [open, phone]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const lookupCep = async () => {
    const cep = form.cep.replace(/\D/g, "");
    if (cep.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json());
      if (!r?.erro) setForm((f) => ({ ...f, logradouro: f.logradouro || r.logradouro || "", bairro: f.bairro || r.bairro || "", cidade: r.localidade || f.cidade, uf: r.uf || f.uf }));
    } catch { /* manual */ }
  };
  const missing = useMemo(() => {
    const m: string[] = [];
    if (form.nome.trim().split(/\s+/).length < 2) m.push("nome e sobrenome");
    if (form.cep.replace(/\D/g, "").length !== 8) m.push("CEP");
    for (const [k, l] of [["logradouro", "rua"], ["numero", "número"], ["bairro", "bairro"], ["cidade", "cidade"]] as const) if (!form[k].trim()) m.push(l);
    if (!/^[A-Za-z]{2}$/.test(form.uf)) m.push("UF");
    return m;
  }, [form]);

  const create = async () => {
    if (missing.length) { toast.error(`Falta: ${missing.join(", ")}`); return; }
    setCreating(true);
    try {
      const data = await call({
        action: "create", idempotency_key: idemKey, service_code: service, reason: reason || null,
        package: { peso_g: Math.max(100, Math.round(Number(peso) || 1000)), c: 33, l: 22, a: 13 },
        customer: { ...form, telefone: phone, uf: form.uf.toUpperCase() },
      });
      setItems((prev) => [data.item, ...prev.filter((i) => i.id !== data.item.id)]);
      setIdemKey(crypto.randomUUID());
      if (data.item.error_message) toast.warning(data.item.error_message);
      else toast.success("Etiqueta de reversa gerada");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao gerar reversa"); }
    finally { setCreating(false); }
  };

  const sendToCustomer = async (it: ReverseItem) => {
    if (!it.codigo_objeto) { toast.error("Código de postagem ainda não disponível"); return; }
    setBusyId(it.id);
    try {
      const first = (form.nome || it.customer_name).trim().split(/\s+/)[0] || "";
      await posSendText({ provider: sendVia, phone, numberId: selectedNumberId, message: reverseWhatsAppText(first, it.codigo_objeto, it.servico_nome || "Correios", brDate(it.valid_until)) });
      if (it.label_url) await posSendMedia({ provider: sendVia, phone, numberId: selectedNumberId, mediaUrl: it.label_url, mediaType: "document", fileName: `etiqueta-devolucao-${it.codigo_objeto}.pdf` }).catch(() => toast.warning("Mensagem enviada, mas o PDF não foi"));
      const r = await call({ action: "mark_sent", id: it.id });
      setItems((prev) => prev.map((x) => (x.id === it.id ? r.item : x)));
      toast.success("Enviado para a cliente");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao enviar"); }
    finally { setBusyId(null); }
  };
  const reprint = async (it: ReverseItem) => {
    setBusyId(it.id);
    try { const r = await call({ action: "label", id: it.id }); setItems((p) => p.map((x) => (x.id === it.id ? r.item : x))); if (r.item.label_url) window.open(r.item.label_url, "_blank"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao abrir etiqueta"); }
    finally { setBusyId(null); }
  };
  const cancel = async (it: ReverseItem) => {
    if (!confirm("Cancelar esta reversa nos Correios?")) return;
    setBusyId(it.id);
    try { const r = await call({ action: "cancel", id: it.id }); setItems((p) => p.map((x) => (x.id === it.id ? r.item : x))); toast.success("Reversa cancelada"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao cancelar"); }
    finally { setBusyId(null); }
  };

  const content = (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><PackageOpen className="h-5 w-5" /> Logística reversa Correios</DialogTitle>
      </DialogHeader>
      <p className="text-xs text-muted-foreground">A cliente envia para a loja Pérola, por conta do nosso contrato. Ela só leva o pacote à agência com o código.</p>
      <p className="rounded-md bg-muted px-2 py-1.5 text-xs font-medium">O código vale {REVERSE_VALID_DAYS} dias para postagem. Depois disso não funciona mais e é preciso gerar outra etiqueta.</p>
      {loading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2"><Label className="text-xs">Nome completo</Label><Input value={form.nome} onChange={set("nome")} /></div>
            <div><Label className="text-xs">CPF</Label><Input value={form.cpf} onChange={set("cpf")} /></div>
            <div><Label className="text-xs">CEP</Label><Input value={form.cep} onChange={set("cep")} onBlur={lookupCep} /></div>
            <div className="col-span-2"><Label className="text-xs">Rua</Label><Input value={form.logradouro} onChange={set("logradouro")} /></div>
            <div><Label className="text-xs">Número</Label><Input value={form.numero} onChange={set("numero")} /></div>
            <div><Label className="text-xs">Complemento</Label><Input value={form.complemento} onChange={set("complemento")} /></div>
            <div><Label className="text-xs">Bairro</Label><Input value={form.bairro} onChange={set("bairro")} /></div>
            <div className="grid grid-cols-[1fr_4rem] gap-2">
              <div><Label className="text-xs">Cidade</Label><Input value={form.cidade} onChange={set("cidade")} /></div>
              <div><Label className="text-xs">UF</Label><Input value={form.uf} maxLength={2} onChange={set("uf")} /></div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Serviço</Label>
              <div className="flex gap-1 mt-1">
                {SERVICES.map((s) => <Button key={s.code} type="button" size="sm" variant={service === s.code ? "default" : "outline"} onClick={() => setService(s.code)}>{s.label}</Button>)}
              </div>
            </div>
            <div><Label className="text-xs">Peso (g) · caixa 33×22×13</Label><Input type="number" value={peso} onChange={(e) => setPeso(e.target.value)} /></div>
            <div className="col-span-2"><Label className="text-xs">Motivo (opcional)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Troca de tamanho, defeito..." /></div>
          </div>
          {missing.length > 0 && <p className="text-xs text-destructive">Falta: {missing.join(", ")}</p>}
          <Button className="w-full" onClick={create} disabled={creating || missing.length > 0}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PackageOpen className="h-4 w-4 mr-2" />} Gerar etiqueta de reversa
          </Button>

          {items.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs font-semibold">Reversas desta cliente</p>
              {items.map((it) => (
                <div key={it.id} className="rounded-md border p-2 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-sm">{it.codigo_objeto || "sem código"}</span>
                    <Badge variant={it.status === "erro" || it.status === "cancelada" ? "destructive" : "secondary"}>{STATUS[it.status] || it.status}</Badge>
                  </div>
                  <div className="text-muted-foreground">{it.servico_nome} · válido até {brDate(it.valid_until)} ({REVERSE_VALID_DAYS} dias) · {new Date(it.created_at).toLocaleDateString("pt-BR")}{it.sent_at ? " · enviado à cliente" : ""}</div>
                  {expired(it) && <div className="rounded bg-destructive/10 px-2 py-1 font-medium text-destructive">Prazo de {REVERSE_VALID_DAYS} dias vencido em {brDate(it.valid_until)} — gerar nova etiqueta para postar.</div>}
                  {it.error_message && <div className="text-destructive">{it.error_message}</div>}
                  {!["cancelada", "erro"].includes(it.status) && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      <Button size="sm" className="h-7" onClick={() => sendToCustomer(it)} disabled={busyId === it.id || !it.codigo_objeto}><Send className="h-3 w-3 mr-1" />{it.sent_at ? "Reenviar" : "Enviar à cliente"}</Button>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => reprint(it)} disabled={busyId === it.id}><Printer className="h-3 w-3 mr-1" />Etiqueta</Button>
                      {it.codigo_objeto && <Button size="sm" variant="outline" className="h-7" onClick={() => { navigator.clipboard.writeText(it.codigo_objeto!); toast.success("Código copiado"); }}><Copy className="h-3 w-3 mr-1" />Copiar</Button>}
                      {it.status !== "postada" && it.status !== "entregue" && <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => cancel(it)} disabled={busyId === it.id}><XCircle className="h-3 w-3 mr-1" />Cancelar</Button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <EmbeddedDialog embedded={embedded} open={open} onOpenChange={onOpenChange}>
      <EmbeddedDialogContent embedded={embedded} className={embedded ? "h-full overflow-y-auto p-4" : "max-w-md max-h-[90vh] overflow-y-auto"}>
        {embedded && <Button variant="ghost" size="sm" className="self-start mb-1" onClick={() => onOpenChange(false)}>← Voltar ao chat</Button>}
        {content}
      </EmbeddedDialogContent>
    </EmbeddedDialog>
  );
}
