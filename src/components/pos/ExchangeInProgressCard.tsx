import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, RotateCcw, Trash2, XCircle, Undo2, AlertTriangle, Repeat, Link2, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MANUAL_PAYMENT_METHODS, PAID_ON_SITE_METHOD } from "@/components/MarkOrderPaidDialog";
import { POSTinyProductPicker } from "./POSTinyProductPicker";
import { ConvertExchangeToReturnDialog } from "./ConvertExchangeToReturnDialog";
import { ConvertReturnToExchangeDialog } from "./ConvertReturnToExchangeDialog";
import { invalidateExchangeRegistry } from "@/hooks/useExchangeRegistry";
import { canAddReplacement, canSwapReplacement, canCancelExchange, canConvertToReturn, canConvertToExchange, isPostingOverdue, OPEN_EXCHANGE_STATUSES, exchangeDifference, differenceLinkTotal, isExchangeDifferencePaid, canMarkDifferencePaid } from "@/lib/pos/exchangeInProgress";

const EXTERNAL_METHODS = MANUAL_PAYMENT_METHODS.filter((m) => m.value !== PAID_ON_SITE_METHOD);
const SITE_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";
const PEROLA_STORE_ID = "4ade7b44-5043-4ab1-a124-7a6ab5468e29";

interface Ex {
  id: string; codigo_devolucao: string | null; tipo: string; status: string; pedido_novo_id: string | null;
  voucher_id: string | null; gateway_refund_id: string | null; created_at: string; diferenca_venda_id: string | null;
  trocas_devolucoes_itens: { direcao: string; sku?: string | null; barcode?: string | null; produto_nome: string | null; tamanho: string | null; quantidade: number | null; valor_unitario: number | null }[];
}
interface Pick { key: number; current?: boolean; sku: string; barcode?: string; name: string; size?: string; quantity: number }

/** Cartão "Troca em andamento" — uma consulta ao abrir o modal (troca + itens) e uma da reversa. */
export function ExchangeInProgressCard({ saleId, onChanged }: { saleId: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<Ex[]>([]);
  const [rev, setRev] = useState<{ valid_until: string | null; codigo_objeto: string | null } | null>(null);
  const [stockStore, setStockStore] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<Ex | null>(null);
  const [swapMode, setSwapMode] = useState(false);
  const [swapMotivo, setSwapMotivo] = useState("");
  const [cancelFor, setCancelFor] = useState<Ex | null>(null);
  const [convertFor, setConvertFor] = useState<Ex | null>(null);
  const [toExchangeFor, setToExchangeFor] = useState<Ex | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [diffSales, setDiffSales] = useState<Record<string, { status: string; total: number; store_id: string; payment_gateway: string | null }>>({});
  const [linkFor, setLinkFor] = useState<Ex | null>(null);
  const [manualPaidFor, setManualPaidFor] = useState<Ex | null>(null);
  const [manualMethod, setManualMethod] = useState("PIX");
  const [manualPixKey, setManualPixKey] = useState("");
  const [manualInstallments, setManualInstallments] = useState("2");
  const [freteModo, setFreteModo] = useState<"gratis" | "cotado" | "fixo">("gratis");
  const [frete, setFrete] = useState(0);
  const [quotes, setQuotes] = useState<{ id: string; label: string; price: number }[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [saleCtx, setSaleCtx] = useState<{ store_id: string; cep: string | null } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("trocas_devolucoes")
      .select("id, codigo_devolucao, tipo, status, pedido_novo_id, voucher_id, gateway_refund_id, created_at, diferenca_venda_id, trocas_devolucoes_itens(direcao, sku, barcode, produto_nome, tamanho, quantidade, valor_unitario)")
      .eq("pedido_original_id", saleId).in("tipo", ["troca", "devolucao"] as any).in("status", OPEN_EXCHANGE_STATUSES as any)
      .order("created_at", { ascending: false }).limit(5);
    const list = (data as any[]) || [];
    setRows(list);
    if (!list.length) return;
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from("correios_reverse_shipments").select("valid_until, codigo_objeto").eq("sale_id", saleId)
        .not("status", "in", "(cancelada,erro)").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("pos_sales").select("store_id, stock_source_store_id, customer_cep").eq("id", saleId).maybeSingle(),
    ]);
    const ids = list.map((x) => x.diferenca_venda_id).filter(Boolean);
    if (ids.length) {
      const { data: ds } = await supabase.from("pos_sales").select("id, status, total, store_id, payment_gateway").in("id", ids);
      setDiffSales(Object.fromEntries(((ds as any[]) || []).map((d) => [d.id, { status: d.status, total: Number(d.total || 0), store_id: d.store_id, payment_gateway: d.payment_gateway || null }])));
    } else setDiffSales({});
    setSaleCtx(s ? { store_id: (s as any).store_id, cep: (s as any).customer_cep || null } : null);
    setRev((r as any) || null);
    const st = (s as any)?.stock_source_store_id || (s as any)?.store_id || null;
    setStockStore(st === SITE_STORE_ID ? PEROLA_STORE_ID : st);
  }, [saleId]);

  useEffect(() => { load(); }, [load]);

  if (!rows.length) return null;

  const done = () => { invalidateExchangeRegistry(); load(); onChanged?.(); };

  const submitAdd = async () => {
    if (!addFor || !picks.length) return;
    if (swapMode && swapMotivo.trim().length < 3) { toast.error("Informe o motivo da troca de produto"); return; }
    setSaving(true);
    const items = picks.map((p) => ({ sku: p.sku, barcode: p.barcode || null, quantity: p.quantity }));
    const { error } = swapMode
      ? await supabase.rpc("exchange_swap_replacement" as any, { p_troca_id: addFor.id, p_items: items, p_motivo: swapMotivo.trim() })
      : await supabase.rpc("exchange_add_replacement" as any, { p_troca_id: addFor.id, p_items: items });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(swapMode
      ? "Produto trocado. O anterior saiu da Expedição e voltou ao estoque; o novo entrou com a tag TROCA."
      : "Produto da troca enviado para a Expedição com a tag TROCA.");
    setAddFor(null); setPicks([]); setSwapMode(false); setSwapMotivo(""); done();
  };

  const submitCancel = async () => {
    if (!cancelFor) return;
    if (motivo.trim().length < 3) { toast.error("Informe o motivo"); return; }
    setSaving(true);
    const { error } = await supabase.rpc("exchange_cancel" as any, { p_troca_id: cancelFor.id, p_motivo: motivo.trim() });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Troca cancelada. Produto reservado saiu da Expedição e voltou ao estoque.");
    setCancelFor(null); setMotivo(""); done();
  };

  const linkUrl = (saleIdX: string, storeId: string) => `https://checkout.bananacalcados.com.br/checkout-loja/${storeId}/${saleIdX}`;
  const copy = async (url: string) => { await navigator.clipboard.writeText(url); toast.success("Link copiado"); };

  const quote = async () => {
    const cep = (saleCtx?.cep || "").replace(/\D/g, "");
    if (cep.length !== 8) { toast.error("Venda original sem CEP para cotar"); return; }
    setQuoting(true);
    const { data: st } = await supabase.from("pos_stores").select("name").eq("id", saleCtx!.store_id).maybeSingle();
    const nm = ((st as any)?.name || "").toLowerCase();
    const { data, error } = await supabase.functions.invoke("checkout-quote-freight", {
      body: { recipient_cep: cep, store: nm.includes("centro") ? "centro" : "perola", total_value: 200, weight_kg: 0.3, items_count: 1, store_id: saleCtx!.store_id },
    });
    setQuoting(false);
    if (error) { toast.error("Não consegui cotar o frete"); return; }
    const q = ((data as any)?.quotes || []).filter((x: any) => Number(x.price) > 0)
      .map((x: any) => ({ id: String(x.id), label: `${x.carrier} ${x.service || ""}${x.delivery_days ? ` · ${x.delivery_days} dias` : ""}`, price: Number(x.price) }));
    setQuotes(q);
    if (!q.length) toast.error("Nenhuma cotação disponível");
  };

  const submitLink = async () => {
    if (!linkFor) return;
    if (freteModo !== "gratis" && !(frete > 0)) { toast.error(freteModo === "cotado" ? "Escolha uma cotação" : "Informe o valor do frete"); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("exchange_create_difference_link" as any, { p_troca_id: linkFor.id, p_frete: freteModo === "gratis" ? 0 : frete, p_frete_modo: freteModo });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    const r = data as any;
    await copy(linkUrl(r.sale_id, r.store_id));
    toast.success(`Link de R$ ${Number(r.total).toFixed(2)} gerado e copiado. Não foi enviado à cliente.`);
    setLinkFor(null); done();
  };

  const closeManualPaid = () => {
    setManualPaidFor(null); setManualMethod("PIX"); setManualPixKey(""); setManualInstallments("2");
  };
  const submitManualPaid = async () => {
    if (!manualPaidFor?.diferenca_venda_id) return;
    const ds = diffSales[manualPaidFor.diferenca_venda_id];
    if (!ds || !canMarkDifferencePaid(ds.status, ds.total)) { toast.error("Esse link não está mais aguardando pagamento"); return; }
    if (manualMethod === "PIX" && manualPixKey.trim().length < 3) { toast.error("Informe em qual chave PIX o pagamento caiu"); return; }
    setSaving(true);
    const { error } = await supabase.rpc("exchange_mark_difference_paid" as any, {
      p_troca_id: manualPaidFor.id,
      p_method: manualMethod,
      p_pix_key: manualMethod === "PIX" ? manualPixKey.trim() : null,
      p_installments: ["Cartão de Crédito parcelado", "Crediário"].includes(manualMethod) ? Number(manualInstallments) : 1,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Diferença de R$ ${ds.total.toFixed(2)} marcada como paga por fora.`);
    closeManualPaid(); done();
  };
  const manualNeedsInstallments = ["Cartão de Crédito parcelado", "Crediário"].includes(manualMethod);

  return (
    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      {rows.map((e) => {
        const overdue = isPostingOverdue(e.status, rev?.valid_until);
        if (e.tipo === "devolucao") return (
          <div key={e.id} className={`rounded-lg border-2 p-3 text-sm ${overdue ? "border-destructive bg-destructive/10" : "border-amber-500 bg-amber-500/10"}`}>
            <div className="flex items-center gap-2 flex-wrap font-bold">
              <Undo2 className="h-4 w-4 shrink-0" /> Devolução em andamento
              <span className="font-mono text-xs">{e.codigo_devolucao}</span>
            </div>
            {rev?.valid_until && <p className="text-xs mt-1">Postagem até {rev.valid_until.split("-").reverse().join("/")}{rev.codigo_objeto ? ` · ${rev.codigo_objeto}` : ""}</p>}
            {overdue && <p className="text-xs mt-1 font-bold text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Prazo de postagem vencido.</p>}
            {canConvertToExchange(e) && (
              <Button size="sm" variant="secondary" className="w-full h-auto whitespace-normal py-1.5 mt-2" onClick={() => setToExchangeFor(e)}><Repeat className="h-3 w-3 mr-1" /> Converter em troca</Button>
            )}
          </div>
        );
        const repos = e.trocas_devolucoes_itens.filter((i) => i.direcao === "reposicao");
        return (
          <div key={e.id} className={`rounded-lg border-2 p-3 text-sm ${overdue ? "border-destructive bg-destructive/10" : "border-amber-500 bg-amber-500/10"}`}>
            <div className="flex items-center gap-2 flex-wrap font-bold">
              <RotateCcw className="h-4 w-4 shrink-0" /> Troca em andamento
              <span className="font-mono text-xs">{e.codigo_devolucao}</span>
            </div>
            {rev?.valid_until && (
              <p className="text-xs mt-1">Postagem até {rev.valid_until.split("-").reverse().join("/")}{rev.codigo_objeto ? ` · ${rev.codigo_objeto}` : ""}</p>
            )}
            {overdue && (
              <p className="text-xs mt-1 font-bold text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Prazo de postagem vencido — continuar (nova reversa) ou cancelar a troca.
              </p>
            )}
            {repos.length > 0 ? (
              <p className="text-xs mt-1">{e.pedido_novo_id ? "Produto da troca na Expedição" : "Produto de troca registrado (ainda não está na Expedição)"}: {repos.map((i) => `${i.quantidade}× ${i.produto_nome}${i.tamanho ? ` (${i.tamanho})` : ""}`).join(", ")}</p>
            ) : (
              <p className="text-xs mt-1 text-muted-foreground">Nenhum produto da troca adicionado ainda.</p>
            )}
            {e.pedido_novo_id && (() => {
              const { dev, rep, diff } = exchangeDifference(e.trocas_devolucoes_itens);
              const ds = e.diferenca_venda_id ? diffSales[e.diferenca_venda_id] : null;
              const paid = isExchangeDifferencePaid(ds?.status);
              return (
                <div className="mt-2 rounded border bg-background/60 p-2 text-xs space-y-1">
                  <p>Devolvido: R$ {dev.toFixed(2)} · Troca: R$ {rep.toFixed(2)}</p>
                  {diff > 0.009 && <p className="font-bold">Cliente paga a diferença: R$ {diff.toFixed(2)}</p>}
                  {diff < -0.009 && <p className="font-bold">Crédito para a cliente: R$ {Math.abs(diff).toFixed(2)} — o voucher (sem validade) sai ao finalizar a troca no PDV.</p>}
                  {Math.abs(diff) <= 0.009 && <p className="font-bold">Sem diferença de valor.</p>}
                  {ds && ds.status !== "cancelled" && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={paid ? "font-bold" : "text-destructive font-bold"}>{paid ? (ds.payment_gateway === "manual" ? "✅ Pago por fora" : "✅ Link pago") : "⏳ Link aguardando pagamento"}: R$ {ds.total.toFixed(2)}</span>
                      {!paid && <Button size="sm" variant="outline" className="h-7" onClick={() => copy(linkUrl(e.diferenca_venda_id!, ds.store_id))}><Copy className="h-3 w-3 mr-1" /> Copiar link</Button>}
                      {canMarkDifferencePaid(ds.status, ds.total) && (
                        <Button size="sm" variant="secondary" className="h-7" onClick={() => { setManualMethod("PIX"); setManualPixKey(""); setManualInstallments("2"); setManualPaidFor(e); }}><CheckCircle2 className="h-3 w-3 mr-1" /> Marcar pago por fora</Button>
                      )}
                    </div>
                  )}
                  {OPEN_EXCHANGE_STATUSES.includes(e.status) && !paid && (
                    <Button size="sm" variant="secondary" className="w-full h-auto whitespace-normal py-1.5" onClick={() => { setFreteModo("gratis"); setFrete(0); setQuotes([]); setLinkFor(e); }}>
                      <Link2 className="h-3 w-3 mr-1" /> {ds && ds.status !== "cancelled" ? "Gerar novo link (substitui o atual)" : diff > 0.009 ? "Gerar link da diferença" : "Gerar link só do frete"}
                    </Button>
                  )}
                </div>
              );
            })()}
            <div className="flex flex-col gap-2 mt-2">
              {canAddReplacement(e) && (
                <Button size="sm" className="w-full h-auto whitespace-normal py-1.5" onClick={() => { setPicks([]); setSwapMode(false); setAddFor(e); }}><Plus className="h-3 w-3 mr-1" /> Adicionar produto</Button>
              )}
              {canSwapReplacement(e, e.diferenca_venda_id ? diffSales[e.diferenca_venda_id]?.status : null) && (
                <Button size="sm" variant="outline" className="w-full h-auto whitespace-normal py-1.5" onClick={() => { setPicks(e.trocas_devolucoes_itens.filter((i) => i.direcao === "reposicao" && i.sku).map((i, n) => ({ key: -1 - n, current: true, sku: i.sku!, barcode: i.barcode || undefined, name: i.produto_nome || i.sku!, size: i.tamanho || undefined, quantity: Number(i.quantidade || 1) }))); setSwapMotivo(""); setSwapMode(true); setAddFor(e); }}><Repeat className="h-3 w-3 mr-1" /> Trocar produto</Button>
              )}
              {canConvertToReturn(e) && (
                <Button size="sm" variant="secondary" className="w-full h-auto whitespace-normal py-1.5" onClick={() => setConvertFor(e)}><Undo2 className="h-3 w-3 mr-1" /> Converter em devolução</Button>
              )}
              {canCancelExchange(e) && (
                <Button size="sm" variant="destructive" className="w-full h-auto whitespace-normal py-1.5" onClick={() => { setMotivo(""); setCancelFor(e); }}><XCircle className="h-3 w-3 mr-1" /> Cancelar troca</Button>
              )}
            </div>
          </div>
        );
      })}

      <Dialog open={!!addFor} onOpenChange={(o) => !o && setAddFor(null)}>
        <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>{swapMode ? "Trocar produto" : "Produto que a cliente vai ficar"} — {addFor?.codigo_devolucao}</DialogTitle></DialogHeader>
          {stockStore && (
            <POSTinyProductPicker storeId={stockStore} label="Buscar produto" value=""
              onSelect={(p) => setPicks((a) => a.length >= 10 ? a : [...a, { key: Date.now(), sku: p.sku, barcode: p.barcode, name: p.product_name, size: p.size, quantity: 1 }])} />
          )}
          <div className="space-y-1">
            {swapMode && <p className="text-xs font-semibold">Produtos da troca (tire o modelo que não vai mais e adicione o novo pela busca):</p>}
            {swapMode && !picks.length && <p className="text-xs text-muted-foreground">Nenhum produto na lista.</p>}
            {picks.map((p) => (
              <div key={p.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{p.name}{p.size ? ` (${p.size})` : ""}{swapMode && <span className={`ml-1 text-[10px] font-bold ${p.current ? "text-muted-foreground" : "text-emerald-600"}`}>{p.current ? "ATUAL" : "NOVO"}</span>}</span>
                <Input type="number" min={1} max={10} value={p.quantity} className="w-16 h-8"
                  onChange={(ev) => setPicks((a) => a.map((x) => x.key === p.key ? { ...x, quantity: Math.max(1, Math.min(10, Number(ev.target.value) || 1)) } : x))} />
                <Button size="icon" variant="ghost" title="Tirar da troca" onClick={() => setPicks((a) => a.filter((x) => x.key !== p.key))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          {swapMode && (
            <>
              <p className="text-sm">A lista acima é como a troca vai ficar. Modelos tirados saem da Expedição e voltam ao estoque.{addFor?.diferenca_venda_id ? " O link da diferença ainda não pago será cancelado — gere outro com o valor novo." : ""}</p>
              <Textarea placeholder="Motivo (obrigatório) — ex.: cliente preferiu outra cor" value={swapMotivo} onChange={(ev) => setSwapMotivo(ev.target.value)} />
            </>
          )}
          <p className="text-xs text-muted-foreground">Vai para a Expedição com a tag TROCA e só pode ser concluído depois de finalizar a troca no PDV. O estoque fica reservado.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddFor(null)}>Voltar</Button>
            <Button onClick={submitAdd} disabled={saving || !picks.length}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} {swapMode ? "Trocar produto" : "Enviar para a Expedição"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkFor} onOpenChange={(o) => !o && setLinkFor(null)}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>Link de pagamento — {linkFor?.codigo_devolucao}</DialogTitle></DialogHeader>
          {linkFor && (() => {
            const { diff } = exchangeDifference(linkFor.trocas_devolucoes_itens);
            return (
              <div className="space-y-3 text-sm">
                <p>Diferença: <b>R$ {Math.max(diff, 0).toFixed(2)}</b></p>
                <div className="flex gap-2 flex-wrap">
                  {(["gratis", "cotado", "fixo"] as const).map((m) => (
                    <Button key={m} size="sm" variant={freteModo === m ? "default" : "outline"} onClick={() => { setFreteModo(m); setFrete(0); }}>
                      {m === "gratis" ? "Frete grátis" : m === "cotado" ? "Cotar frete" : "Valor fixo"}
                    </Button>
                  ))}
                </div>
                {freteModo === "cotado" && (
                  <div className="space-y-1">
                    <Button size="sm" variant="outline" onClick={quote} disabled={quoting}>{quoting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Cotar pelo CEP da cliente</Button>
                    {quotes.map((q) => (
                      <label key={q.id} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="frete-q" checked={frete === q.price} onChange={() => setFrete(q.price)} />
                        <span className="flex-1">{q.label}</span><b>R$ {q.price.toFixed(2)}</b>
                      </label>
                    ))}
                  </div>
                )}
                {freteModo === "fixo" && (
                  <Input type="number" min={0} max={500} step="0.01" placeholder="Valor do frete" value={frete || ""} onChange={(ev) => setFrete(Math.max(0, Math.min(500, Number(ev.target.value) || 0)))} />
                )}
                <p className="font-bold">Total do link: R$ {differenceLinkTotal(diff, frete, freteModo).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">O valor é recalculado pelo sistema. O link é copiado, não é enviado à cliente. Enquanto não for pago, o produto da troca não pode ser concluído na Expedição.</p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setLinkFor(null)}>Voltar</Button>
                  <Button onClick={submitLink} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Gerar e copiar link</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!manualPaidFor} onOpenChange={(o) => !o && closeManualPaid()}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Marcar diferença como PAGA</DialogTitle>
            <DialogDescription>
              {manualPaidFor?.codigo_devolucao} · {manualPaidFor?.diferenca_venda_id ? `R$ ${(diffSales[manualPaidFor.diferenca_venda_id]?.total || 0).toFixed(2)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Como a cliente pagou?</label>
              <Select value={manualMethod} onValueChange={setManualMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXTERNAL_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {manualMethod === "PIX" && (
              <div className="space-y-1">
                <label className="text-xs font-semibold">Em qual chave PIX caiu?</label>
                <Input value={manualPixKey} onChange={(ev) => setManualPixKey(ev.target.value)} placeholder="CNPJ, CPF, e-mail ou outra chave" autoFocus />
              </div>
            )}
            {manualNeedsInstallments && (
              <div className="space-y-1">
                <label className="text-xs font-semibold">Parcelas</label>
                <Select value={manualInstallments} onValueChange={setManualInstallments}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>{n}x</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Confirme só depois de conferir o recebimento. O valor é validado pelo sistema e a confirmação fica registrada com o seu usuário.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeManualPaid} disabled={saving}>Voltar</Button>
              <Button onClick={submitManualPaid} disabled={saving || (manualMethod === "PIX" && manualPixKey.trim().length < 3)}>{saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />} Confirmar pagamento</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConvertExchangeToReturnDialog troca={convertFor} onClose={() => setConvertFor(null)} onDone={done} />
      <ConvertReturnToExchangeDialog troca={toExchangeFor} onClose={() => setToExchangeFor(null)} onDone={done} />

      <Dialog open={!!cancelFor} onOpenChange={(o) => !o && setCancelFor(null)}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>Cancelar troca {cancelFor?.codigo_devolucao}?</DialogTitle></DialogHeader>
          <Textarea placeholder="Motivo (obrigatório) — ex.: cliente perdeu o prazo de postagem" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <p className="text-xs text-muted-foreground">O produto reservado sai da Expedição e volta ao estoque. Não mexe na etiqueta dos Correios nem manda mensagem pra cliente.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelFor(null)}>Voltar</Button>
            <Button variant="destructive" onClick={submitCancel} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Cancelar troca</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
