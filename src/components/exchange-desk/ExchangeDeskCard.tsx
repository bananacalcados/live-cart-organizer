// Cartão da solicitação: dados, histórico e ações do atendente.
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { createNewExchange, motivoReposEstoquePadrao } from "@/lib/pos/newExchange";
import { POSWhatsAppReverseDialog } from "@/components/pos/POSWhatsAppReverseDialog";
import { canAct, daysLeft, fillTemplate, waLink, REASON_LABEL, STATUS_LABEL, SOURCE_LABEL, TD_MOTIVO, type DeskAction } from "@/lib/exchangeDesk/rules";
import { deskAction, deskCall, loadTemplates, type DeskTemplate } from "./api";

type Form = { kind: "approve" | "deny" | "request_info" | "note" | "offer_size" | "create_troca"; reason: string; note: string; tpl?: string };
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
const brl = (v: any) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
const ACTION_LABEL: Record<string, string> = {
  assign: "Atribuiu", approve: "Aprovou", deny: "Negou", request_info: "Pediu mais informação", offer_size: "Ofereceu outra numeração",
  note: "Observação", link_troca: "Abriu registro de troca", set_reverse: "Gerou reversa", open_whatsapp: "Abriu WhatsApp",
};

export function ExchangeDeskCard({ id, staff, onClose, onChanged }: { id: string; staff: { id: string; name: string }[]; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [d, setD] = useState<any>(null);
  const [tpl, setTpl] = useState<Record<string, DeskTemplate>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [sizes, setSizes] = useState<{ id: string; size: string; available: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReverse, setConfirmReverse] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [antecipado, setAntecipado] = useState(false);
  const [antecipadoMotivo, setAntecipadoMotivo] = useState("");

  const load = useCallback(async () => {
    try { setD(await deskCall("exchange_desk_detail", { p_id: id })); }
    catch (e) { toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" }); }
  }, [id, toast]);
  useEffect(() => { load(); loadTemplates().then(setTpl); supabase.auth.getUser().then(({ data }) => setUid(data.user?.id || null)); }, [load]);

  if (!d) return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Carregando…</DialogTitle></DialogHeader></DialogContent></Dialog>;

  const r = d.request;
  const actor = { isHuman: !!uid, isStaff: true };
  const can = (a: DeskAction, reason = "") => canAct(r, a, actor, reason);
  const firstName = String(r.customer_name || "").split(" ")[0];
  const vars = { nome: firstName, pedido: r.order_number || r.order_ref || "", codigo: r.reverse_shipping_code || "", motivo: form?.reason || "", numeracoes: (sizes || []).map((s) => s.size).filter(Boolean).join(", ") };
  const msg = (key: string) => fillTemplate(tpl[key]?.body || "", vars);
  const left = daysLeft(r.deadline_at);
  const prev = (d.previous || []) as any[];

  const run = async (action: string, extra: Record<string, string | undefined> = {}, ok = "Feito") => {
    setBusy(true);
    try { await deskAction(id, action, extra); toast({ title: ok }); setForm(null); await load(); onChanged(); return true; }
    catch (e) { toast({ title: "Não deu certo", description: e instanceof Error ? e.message : "", variant: "destructive" }); return false; }
    finally { setBusy(false); }
  };

  const openWa = (text: string) => { window.open(waLink(r.phone, text), "_blank", "noopener"); deskAction(id, "open_whatsapp").catch(() => {}); };

  const openSizes = async () => {
    setForm({ kind: "offer_size", reason: "", note: "" });
    try { setSizes(await deskCall("exchange_desk_sizes", { p_id: id })); } catch { setSizes([]); }
  };

  const createTroca = async () => {
    if (!d.sale?.store_id) { toast({ title: "Venda sem loja", description: "Abra a troca manualmente no PDV.", variant: "destructive" }); return; }
    const item = (d.items || []).find((i: any) => i.id === r.original_item_id);
    if (!item) { toast({ title: "Item original não encontrado", variant: "destructive" }); return; }
    if (antecipado && antecipadoMotivo.trim().length < 3) { toast({ title: "Escreva o motivo do despacho antecipado", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const motivo = TD_MOTIVO[r.reason_category] || "outro";
      const rep = d.replacement;
      const res = await createNewExchange({
        tipo: r.request_type === "devolucao" ? "devolucao" : "troca", motivo, origem_canal: "site",
        loja_origem_id: d.sale.store_id, pedido_original_id: d.sale.id,
        cliente_nome: r.customer_name, cliente_whatsapp: r.phone,
        modo_expedicao: antecipado ? "despacho_antecipado" : "aguarda_retorno",
        motivo_excecao_antecipado: antecipado ? antecipadoMotivo.trim().slice(0, 200) : null,
        status: "aguardando_retorno",
        devolvidos: [{ produto_id: null, sku: item.sku, barcode: item.barcode, produto_nome: item.product_name, tamanho: item.size, quantidade: r.requested_quantity || 1, valor_unitario: Number(item.unit_price || 0), repoe_estoque: motivoReposEstoquePadrao(motivo) }],
        reposicoes: r.request_type === "troca" && rep ? [{ produto_id: rep.id, sku: rep.sku, barcode: rep.barcode, produto_nome: rep.name, tamanho: rep.size, quantidade: r.requested_quantity || 1, valor_unitario: Number(rep.price || item.unit_price || 0), estado_estoque: antecipado ? "despachado" : "reservado" }] : [],
      });
      await run("link_troca", { p_troca_id: res.id }, `Registro ${res.codigo_devolucao} aberto`);
    } catch (e) { toast({ title: "Não abriu o registro", description: e instanceof Error ? e.message : "", variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const formTitle: Record<Form["kind"], string> = {
    approve: "Aprovar (exceção)", deny: "Negar", request_info: "Pedir mais informação", note: "Observação interna", offer_size: "Oferecer outra numeração", create_troca: "Abrir registro da troca",
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Badge>{r.request_type === "troca" ? "Troca" : "Devolução"}</Badge>{r.customer_name || "Cliente"}
              <Badge variant="outline">{STATUS_LABEL[r.status] || r.status}</Badge>
            </DialogTitle>
          </DialogHeader>

          {r.status === "escalado" && r.escalated_reason && <div className="rounded-md bg-muted p-2 text-sm">Por que veio pra você: <b>{r.escalated_reason}</b></div>}
          {prev.length + Number(d.previous_legacy || 0) > 0 && (
            <div className="rounded-md border border-destructive p-2 text-sm">
              ⚠️ Esta cliente já tem {prev.length + Number(d.previous_legacy || 0)} outra(s) troca(s)/devolução(ões).
              {prev.slice(0, 5).map((p) => <div key={p.id} className="text-xs text-muted-foreground">{fmtDate(p.created_at)} · {p.type === "troca" ? "Troca" : "Devolução"} · {p.product_name} · {STATUS_LABEL[p.status] || p.status}</div>)}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <div><b>Pedido:</b> {r.order_number || r.order_ref || "—"} {d.sale?.store_name ? `· ${d.sale.store_name}` : ""}</div>
              <div><b>Compra:</b> {fmtDate(d.sale?.created_at)} · {brl(d.sale?.total)}</div>
              <div><b>Telefone:</b> {r.phone}</div>
              <div><b>Entrega:</b> {fmtDate(d.delivery?.delivered_at)} — {SOURCE_LABEL(d.delivery?.source)}</div>
              {d.delivery?.customer_reported_at && <div><b>Cliente disse que recebeu:</b> {fmtDate(d.delivery.customer_reported_at)}</div>}
              <div><b>Prazo:</b> {fmtDate(r.deadline_at)} {left !== null && (left >= 0 ? `(${left} dia(s) restantes)` : <span className="text-destructive">({-left} dia(s) excedidos)</span>)}</div>
              <div><b>Elegibilidade:</b> {r.eligibility === "eligible" ? "Dentro das regras" : r.eligibility === "needs_human" ? "Precisa de análise" : r.eligibility || "—"}{r.eligibility_reason ? ` — ${r.eligibility_reason}` : ""}</div>
            </div>
            <div className="space-y-1">
              <div><b>Motivo:</b> {REASON_LABEL[r.reason_category] || "—"}</div>
              <div><b>O que a cliente escreveu:</b> {r.reason_subcategory || r.customer_verbatim || "—"}</div>
              <div><b>Condição do produto:</b> {r.auto_approved ? "Declarou sem uso" : "Não registrada — confirme com a cliente"}</div>
              <div><b>Item:</b> {r.requested_quantity || 1}× {r.product_name} {r.product_size ? `nº ${r.product_size}` : ""}</div>
              {d.replacement && <div><b>Quer trocar por:</b> {d.replacement.name} nº {d.replacement.size}</div>}
              {d.troca && <div><b>Registro no sistema:</b> {d.troca.codigo} ({d.troca.status})</div>}
              <div><b>NF de devolução:</b> {d.nfe_devolucao ? `${d.nfe_devolucao.status === "authorized" ? "Autorizada" : d.nfe_devolucao.status} nº ${d.nfe_devolucao.numero ?? "—"}` : "Ainda não existe"}</div>
              {r.reverse_shipping_code && <div><b>Código de postagem:</b> {r.reverse_shipping_code}</div>}
              {r.decision_reason && <div><b>Decisão:</b> {r.decision_reason} ({r.reviewed_by})</div>}
            </div>
          </div>

          <div className="text-xs text-muted-foreground">Itens do pedido: {(d.items || []).map((i: any) => `${i.quantity}× ${i.product_name}${i.size ? ` nº ${i.size}` : ""}`).join(" · ") || "—"}</div>

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button size="sm" variant="outline" onClick={() => openWa(`Oi ${firstName}! Aqui é da Banana Calçados, sobre sua solicitação do pedido ${vars.pedido}.`)}>Abrir WhatsApp</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run("assign", {}, "Agora está com você")}>Atribuir a mim</Button>
            <Select onValueChange={(v) => run("assign", { p_assignee: v }, "Reatribuída")}>
              <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Reatribuir…" /></SelectTrigger>
              <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            {can("offer_size") === null && <Button size="sm" variant="outline" onClick={openSizes}>Oferecer outra numeração</Button>}
            {can("request_info") === null && <Button size="sm" variant="outline" onClick={() => setForm({ kind: "request_info", reason: "", note: "", tpl: "pedir_foto" })}>Pedir mais informação</Button>}
            {r.status === "escalado" && <Button size="sm" onClick={() => setForm({ kind: "approve", reason: "", note: "" })}>Aprovar</Button>}
            {can("deny", "xxx") === null && <Button size="sm" variant="destructive" onClick={() => setForm({ kind: "deny", reason: "", note: "", tpl: "negada" })}>Negar</Button>}
            {can("create_troca") === null && <Button size="sm" onClick={() => setForm({ kind: "create_troca", reason: "", note: "" })}>Abrir registro da {r.request_type === "troca" ? "troca" : "devolução"}</Button>}
            {can("reverse") === null && <Button size="sm" onClick={() => setConfirmReverse(true)}>Gerar reversa dos Correios</Button>}
            {d.troca && <Button size="sm" variant="outline" onClick={() => navigate("/pos")}>Abrir no PDV ({d.troca.codigo})</Button>}
            <Button size="sm" variant="ghost" onClick={() => setForm({ kind: "note", reason: "", note: "" })}>Observação interna</Button>
          </div>
          {r.request_type === "devolucao" && <p className="text-xs text-muted-foreground">Devolução: não prometa valor nem prazo de reembolso. Estorno, voucher e nota seguem pelo fluxo normal do PDV.</p>}

          {form && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="font-medium text-sm">{formTitle[form.kind]}</div>
              {form.kind === "offer_size" && (
                <div className="text-sm">{sizes === null ? "Buscando numerações…" : sizes.length === 0 ? "Nenhuma outra numeração com estoque." :
                  <>Com estoque: {sizes.map((s) => <Badge key={s.id} variant="outline" className="mr-1">nº {s.size} ({s.available})</Badge>)}</>}</div>
              )}
              {(form.kind === "approve" || form.kind === "deny") && (
                <Input placeholder={form.kind === "approve" ? "Motivo da exceção (obrigatório)" : "Motivo da negativa (obrigatório)"} value={form.reason} maxLength={300} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              )}
              {form.kind === "create_troca" && (
                <div className="space-y-2 text-sm">
                  <p>O produto novo só sai depois que o devolvido chegar e for conferido.</p>
                  {r.request_type === "troca" && <label className="flex gap-2 items-center"><input type="checkbox" checked={antecipado} onChange={(e) => setAntecipado(e.target.checked)} />Despachar antes (exceção)</label>}
                  {antecipado && <Input placeholder="Motivo do despacho antecipado" value={antecipadoMotivo} maxLength={200} onChange={(e) => setAntecipadoMotivo(e.target.value)} />}
                </div>
              )}
              {form.kind !== "create_troca" && <Textarea rows={2} placeholder="Observação interna (opcional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}
              {(form.kind === "offer_size" || form.kind === "deny" || form.kind === "request_info") && (
                <div className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{msg(form.kind === "offer_size" ? "oferecer_numeracao" : form.kind === "deny" ? "negada" : "pedir_foto")}</div>
              )}
              <div className="flex gap-2 flex-wrap">
                {form.kind === "create_troca" ? <Button size="sm" disabled={busy} onClick={createTroca}>Confirmar</Button> :
                  <Button size="sm" disabled={busy || (form.kind === "approve" || form.kind === "deny") && form.reason.trim().length < 3}
                    onClick={async () => {
                      const ok = await run(form.kind, { p_reason: form.reason || undefined, p_note: form.note || undefined }, "Registrado");
                      const key = form.kind === "offer_size" ? "oferecer_numeracao" : form.kind === "deny" ? "negada" : form.kind === "request_info" ? "pedir_foto" : form.kind === "approve" ? (r.request_type === "troca" ? "aprovada" : null) : null;
                      if (ok && key) openWa(msg(key));
                    }}>{form.kind === "note" ? "Salvar" : "Confirmar e abrir WhatsApp"}</Button>}
                <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
              </div>
            </div>
          )}

          <div className="border-t pt-2 space-y-1">
            <div className="text-sm font-medium">Histórico</div>
            {(d.history || []).length === 0 && <div className="text-xs text-muted-foreground">Sem ações ainda.</div>}
            {(d.history || []).map((h: any) => (
              <div key={h.id} className="text-xs"><b>{h.actor_name || "Equipe"}</b> · {new Date(h.created_at).toLocaleString("pt-BR")} · {ACTION_LABEL[h.action] || h.action}{h.reason ? ` — ${h.reason}` : ""}{h.note ? ` (${h.note})` : ""}</div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReverse} onOpenChange={setConfirmReverse}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar reversa dos Correios?</AlertDialogTitle>
            <AlertDialogDescription>Isso gera o código de postagem e emite a NF-e de devolução. Se já existir nota de devolução para esta venda, ela é reaproveitada — nunca emitida em dobro.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => setReverseOpen(true)}>Continuar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {reverseOpen && d.sale && (
        <POSWhatsAppReverseDialog open={reverseOpen} onOpenChange={setReverseOpen} phone={r.phone} customerName={r.customer_name || undefined}
          purpose={r.request_type === "devolucao" ? "devolucao" : "troca"} lockedSaleId={d.sale.id}
          lockedQty={r.original_item_id ? { [r.original_item_id]: r.requested_quantity || 1 } : undefined}
          onUseCode={async (code) => { setReverseOpen(false); const ok = await run("set_reverse", { p_code: code.trim().toUpperCase() }, "Reversa vinculada"); if (ok) openWa(fillTemplate(tpl.instrucoes_reversa?.body || "", { ...vars, codigo: code })); }} />
      )}
    </>
  );
}
