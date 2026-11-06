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
  /** Sem provedor (ex.: tela de trocas) o botão "Enviar à cliente" fica oculto. */
  sendVia?: PosSendProvider;
  selectedNumberId?: string | null;
  embedded?: boolean;
  /** Quando informado, mostra "Usar nesta troca" para preencher o código em outra tela. */
  onUseCode?: (code: string) => void;
  /** Troca ou devolução: define a mensagem. Sem valor, a equipe escolhe na tela. */
  purpose?: ReversePurpose;
}

interface ReverseItem {
  id: string; created_at: string; customer_name: string; servico_nome: string | null; valid_until: string | null;
  status: string; codigo_objeto: string | null; label_url: string | null; error_message: string | null; sent_at: string | null; reason: string | null;
  sale_id?: string | null;
  nfe_devolucao?: { status: string; numero: number | null; chave: string | null; danfe_url: string | null; erro: string | null } | null;
}
interface SaleOption {
  id: string; created_at: string; total: number | null; nfe: { numero: number | null; modelo: number } | null;
  items: { id: string; product_name: string | null; quantity: number; unit_price: number }[];
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

export type ReversePurpose = "troca" | "devolucao";

/** Mensagem da reversa para a cliente (formatação do WhatsApp). Troca e devolução só diferem no prazo final. */
export function reverseWhatsAppText(code: string, purpose: ReversePurpose, validUntil?: string) {
  const prazo = purpose === "troca"
    ? "🔄 *O envio da troca é feito em até 2 dias úteis após o recebimento do produto em nossa loja.*"
    : "💸 *O estorno da compra é feito em até 2 dias úteis após o recebimento do produto em nossa loja.*";
  return [
    "📦 Segue seu código de *logística reversa*:",
    "",
    `👉 *${code}*`,
    "",
    `⏳ *Ele tem a validade de 7 dias contando a partir de hoje*${validUntil ? ` (até ${validUntil})` : ""}.`,
    "⚠️ Após esse prazo não é possível gerar um novo código e, por isso, se perde o direito à solicitação feita.",
    "",
    prazo,
    "",
    "✅ *Como usar é bem simples:*",
    "1️⃣ Coloque o produto em uma caixa (pode ser a original);",
    "2️⃣ Imprima a *nota fiscal de devolução* que vai logo abaixo e coloque junto, por fora da caixa ou na mão para mostrar no balcão;",
    "3️⃣ Embale e lacre bem;",
    "4️⃣ Leve a uma agência dos Correios.",
    "",
    "Apresente o código e a nota e pronto! Farão a postagem da sua compra 😃",
  ].join("\n");
}

export function POSWhatsAppReverseDialog({ open, onOpenChange, phone, customerName, sendVia, selectedNumberId = null, embedded = false, onUseCode, purpose: purposeProp }: Props) {
  const [purposeSel, setPurposeSel] = useState<ReversePurpose>(purposeProp ?? "devolucao");
  useEffect(() => { if (purposeProp) setPurposeSel(purposeProp); }, [purposeProp]);
  const purpose = purposeProp ?? purposeSel;
  const [form, setForm] = useState({ nome: customerName || "", cpf: "", email: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "" });
  const [service, setService] = useState("03301");
  const [peso, setPeso] = useState("1000");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [items, setItems] = useState<ReverseItem[]>([]);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [sales, setSales] = useState<SaleOption[]>([]);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open || !phone) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [known, list, sl] = await Promise.all([
          loadKnownCustomerByPhone(phone, null).catch(() => null),
          call({ action: "list", phone }).catch(() => ({ items: [] })),
          call({ action: "sales", phone }).catch(() => ({ sales: [] })),
        ]);
        if (!alive) return;
        if (known) setForm((f) => ({
          nome: f.nome || known.name || "", cpf: known.cpf || "", email: known.email || "", cep: known.cep || "", logradouro: known.address || "",
          numero: known.address_number || "", complemento: known.complement || "", bairro: known.neighborhood || "", cidade: known.city || "", uf: (known.state || "").slice(0, 2).toUpperCase(),
        }));
        setItems(list.items || []);
        setSales(sl.sales || []);
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
    if (form.cpf.replace(/\D/g, "").length !== 11) m.push("CPF");
    if (!saleId) m.push("venda original");
    else if (!Object.values(qty).some((q) => q > 0)) m.push("itens devolvidos");
    return m;
  }, [form, saleId, qty]);
  const sale = sales.find((x) => x.id === saleId) || null;
  const pickSale = (id: string) => { setSaleId(id); const s = sales.find((x) => x.id === id); setQty(s && s.items.length === 1 ? { [s.items[0].id]: 1 } : {}); };

  const create = async () => {
    if (missing.length) { toast.error(`Falta: ${missing.join(", ")}`); return; }
    setCreating(true);
    try {
      const data = await call({
        action: "create", idempotency_key: idemKey, service_code: service, reason: reason || null,
        package: { peso_g: Math.max(100, Math.round(Number(peso) || 1000)), c: 33, l: 22, a: 13 },
        customer: { ...form, telefone: phone, uf: form.uf.toUpperCase() },
        sale_id: saleId,
        return_items: Object.entries(qty).filter(([, q]) => q > 0).map(([sale_item_id, quantidade]) => ({ sale_item_id, quantidade })),
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
      const text = reverseWhatsAppText(it.codigo_objeto, purpose, brDate(it.valid_until));
      const mid = await posSendText({ provider: sendVia, phone, numberId: selectedNumberId, message: text });
      // Registra no histórico do chat (o envio pela API não volta sozinho para a conversa).
      try {
        await supabase.from("whatsapp_messages").insert({
          phone, message: text, direction: "outgoing", status: "sent",
          message_id: mid || null, whatsapp_number_id: selectedNumberId || null,
        } as any);
      } catch { /* histórico não deve quebrar o envio */ }
      const danfe = it.nfe_devolucao?.status === "authorized" ? it.nfe_devolucao.danfe_url : null;
      if (danfe) await posSendMedia({ provider: sendVia, phone, numberId: selectedNumberId, mediaUrl: danfe, mediaType: "document", fileName: `nota-devolucao-${it.nfe_devolucao?.numero || ""}.pdf` }).catch(() => toast.warning("Mensagem enviada, mas a nota de devolução não foi"));
      if (it.label_url) await posSendMedia({ provider: sendVia, phone, numberId: selectedNumberId, mediaUrl: it.label_url, mediaType: "document", fileName: `etiqueta-devolucao-${it.codigo_objeto}.pdf` }).catch(() => toast.warning("Mensagem enviada, mas o PDF não foi"));
      const r = await call({ action: "mark_sent", id: it.id });
      setItems((prev) => prev.map((x) => (x.id === it.id ? r.item : x)));
      toast.success("Enviado para a cliente");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao enviar"); }
    finally { setBusyId(null); }
  };
  const retry = async (it: ReverseItem) => {
    setBusyId(it.id);
    try { const r = await call({ action: "retry", id: it.id }); setItems((p) => p.map((x) => (x.id === it.id ? r.item : x))); toast.success("Reversa gerada"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao tentar de novo"); const l = await call({ action: "list", phone }).catch(() => null); if (l) setItems(l.items || []); }
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
      <p className="text-xs text-muted-foreground">A cliente é a remetente e envia para a loja Pérola, por conta do nosso contrato. Antes do código, o sistema emite a nota de devolução, que vai junto com a mensagem.</p>
      <p className="rounded-md bg-muted px-2 py-1.5 text-xs font-medium">O código vale {REVERSE_VALID_DAYS} dias para postagem. Depois disso não funciona mais e é preciso gerar outra etiqueta.</p>
      {loading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2"><Label className="text-xs">Nome completo</Label><Input value={form.nome} onChange={set("nome")} /></div>
            <div><Label className="text-xs">CPF (obrigatório)</Label><Input value={form.cpf} onChange={set("cpf")} /></div>
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
          <div className="space-y-1">
            <Label className="text-xs">Venda original (a nota de devolução referencia a nota dela)</Label>
            {sales.length === 0 ? <p className="text-xs text-destructive">Nenhuma venda encontrada para este telefone.</p> : (
              <div className="space-y-1">
                {sales.map((s) => (
                  <button key={s.id} type="button" disabled={!s.nfe} onClick={() => pickSale(s.id)}
                    className={`w-full rounded-md border px-2 py-1 text-left text-xs ${saleId === s.id ? "border-primary bg-primary/5" : ""} ${!s.nfe ? "opacity-50" : ""}`}>
                    {new Date(s.created_at).toLocaleDateString("pt-BR")} · R$ {Number(s.total || 0).toFixed(2).replace(".", ",")} · {s.nfe ? `NF ${s.nfe.numero ?? ""}` : "sem nota autorizada"}
                  </button>
                ))}
              </div>
            )}
            {sale && (
              <div className="space-y-1 rounded-md bg-muted p-2">
                <p className="text-xs font-medium">Quantos de cada item ela devolve?</p>
                {sale.items.map((i) => (
                  <div key={i.id} className="flex items-center gap-2 text-xs">
                    <Input type="number" min={0} max={i.quantity} className="h-7 w-14" value={qty[i.id] ?? 0}
                      onChange={(e) => setQty((q) => ({ ...q, [i.id]: Math.max(0, Math.min(i.quantity, Math.round(Number(e.target.value) || 0))) }))} />
                    <span className="flex-1">{i.product_name} <span className="text-muted-foreground">(comprou {i.quantity})</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {sendVia && (
            <div>
              <Label className="text-xs">Mensagem para a cliente</Label>
              {purposeProp ? (
                <p className="mt-1 text-xs font-medium">{purpose === "troca" ? "Troca" : "Devolução"} (definido na troca/devolução)</p>
              ) : (
                <div className="flex gap-1 mt-1">
                  {(["devolucao", "troca"] as const).map((t) => <Button key={t} type="button" size="sm" variant={purposeSel === t ? "default" : "outline"} onClick={() => setPurposeSel(t)}>{t === "troca" ? "Troca" : "Devolução"}</Button>)}
                </div>
              )}
            </div>
          )}
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
                  {it.nfe_devolucao?.status === "authorized" && <div>Nota de devolução nº {it.nfe_devolucao.numero}{it.nfe_devolucao.danfe_url && <> · <a className="underline" href={it.nfe_devolucao.danfe_url} target="_blank" rel="noreferrer">abrir nota</a></>}</div>}
                  {!it.nfe_devolucao && it.status !== "cancelada" && <div className="text-muted-foreground">Sem nota de devolução (etiqueta antiga — gere de novo)</div>}
                  {it.error_message && <div className="text-destructive">{it.error_message}</div>}
                  {it.status === "erro" && it.sale_id && <Button size="sm" variant="outline" className="h-7" onClick={() => retry(it)} disabled={busyId === it.id}>Tentar de novo</Button>}
                  {!["cancelada", "erro"].includes(it.status) && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {onUseCode && it.codigo_objeto && <Button size="sm" className="h-7" onClick={() => { onUseCode(it.codigo_objeto!); onOpenChange(false); }}>Usar nesta troca</Button>}
                      {sendVia && <Button size="sm" className="h-7" onClick={() => sendToCustomer(it)} disabled={busyId === it.id || !it.codigo_objeto}><Send className="h-3 w-3 mr-1" />{it.sent_at ? "Reenviar" : "Enviar à cliente"}</Button>}
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
