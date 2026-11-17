import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, RotateCcw, Trash2, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { POSTinyProductPicker } from "./POSTinyProductPicker";
import { invalidateExchangeRegistry } from "@/hooks/useExchangeRegistry";
import { canAddReplacement, canCancelExchange, isPostingOverdue, OPEN_EXCHANGE_STATUSES } from "@/lib/pos/exchangeInProgress";

const SITE_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";
const PEROLA_STORE_ID = "4ade7b44-5043-4ab1-a124-7a6ab5468e29";

interface Ex {
  id: string; codigo_devolucao: string | null; tipo: string; status: string; pedido_novo_id: string | null;
  voucher_id: string | null; gateway_refund_id: string | null; created_at: string;
  trocas_devolucoes_itens: { direcao: string; produto_nome: string | null; tamanho: string | null; quantidade: number | null }[];
}
interface Pick { key: number; sku: string; barcode?: string; name: string; size?: string; quantity: number }

/** Cartão "Troca em andamento" — uma consulta ao abrir o modal (troca + itens) e uma da reversa. */
export function ExchangeInProgressCard({ saleId, onChanged }: { saleId: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<Ex[]>([]);
  const [rev, setRev] = useState<{ valid_until: string | null; codigo_objeto: string | null } | null>(null);
  const [stockStore, setStockStore] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<Ex | null>(null);
  const [cancelFor, setCancelFor] = useState<Ex | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("trocas_devolucoes")
      .select("id, codigo_devolucao, tipo, status, pedido_novo_id, voucher_id, gateway_refund_id, created_at, trocas_devolucoes_itens(direcao, produto_nome, tamanho, quantidade)")
      .eq("pedido_original_id", saleId).eq("tipo", "troca").in("status", OPEN_EXCHANGE_STATUSES as any)
      .order("created_at", { ascending: false }).limit(5);
    const list = (data as any[]) || [];
    setRows(list);
    if (!list.length) return;
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from("correios_reverse_shipments").select("valid_until, codigo_objeto").eq("sale_id", saleId)
        .not("status", "in", "(cancelada,erro)").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("pos_sales").select("store_id, stock_source_store_id").eq("id", saleId).maybeSingle(),
    ]);
    setRev((r as any) || null);
    const st = (s as any)?.stock_source_store_id || (s as any)?.store_id || null;
    setStockStore(st === SITE_STORE_ID ? PEROLA_STORE_ID : st);
  }, [saleId]);

  useEffect(() => { load(); }, [load]);

  if (!rows.length) return null;

  const done = () => { invalidateExchangeRegistry(); load(); onChanged?.(); };

  const submitAdd = async () => {
    if (!addFor || !picks.length) return;
    setSaving(true);
    const { error } = await supabase.rpc("exchange_add_replacement" as any, {
      p_troca_id: addFor.id,
      p_items: picks.map((p) => ({ sku: p.sku, barcode: p.barcode || null, quantity: p.quantity })),
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Produto da troca enviado para a Expedição com a tag TROCA.");
    setAddFor(null); setPicks([]); done();
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

  return (
    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      {rows.map((e) => {
        const overdue = isPostingOverdue(e.status, rev?.valid_until);
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
            <div className="flex flex-col gap-2 mt-2">
              {canAddReplacement(e) && (
                <Button size="sm" className="w-full h-auto whitespace-normal py-1.5" onClick={() => { setPicks([]); setAddFor(e); }}><Plus className="h-3 w-3 mr-1" /> Adicionar produto</Button>
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
          <DialogHeader><DialogTitle>Produto que a cliente vai ficar — {addFor?.codigo_devolucao}</DialogTitle></DialogHeader>
          {stockStore && (
            <POSTinyProductPicker storeId={stockStore} label="Buscar produto" value=""
              onSelect={(p) => setPicks((a) => a.length >= 10 ? a : [...a, { key: Date.now(), sku: p.sku, barcode: p.barcode, name: p.product_name, size: p.size, quantity: 1 }])} />
          )}
          <div className="space-y-1">
            {picks.map((p) => (
              <div key={p.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{p.name}{p.size ? ` (${p.size})` : ""}</span>
                <Input type="number" min={1} max={10} value={p.quantity} className="w-16 h-8"
                  onChange={(ev) => setPicks((a) => a.map((x) => x.key === p.key ? { ...x, quantity: Math.max(1, Math.min(10, Number(ev.target.value) || 1)) } : x))} />
                <Button size="icon" variant="ghost" onClick={() => setPicks((a) => a.filter((x) => x.key !== p.key))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Vai para a Expedição com a tag TROCA e só pode ser concluído depois de finalizar a troca no PDV. O estoque fica reservado. Diferença de valor entra na próxima etapa.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddFor(null)}>Voltar</Button>
            <Button onClick={submitAdd} disabled={saving || !picks.length}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Enviar para a Expedição</Button>
          </div>
        </DialogContent>
      </Dialog>

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
