import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTeamIdentity } from "@/hooks/chat/useTeamIdentity";
import { printA4VariantLabels, type LabelItem } from "./ProductLabelPrintDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PAGE_SIZE = 50;
const MODE_LABELS: Record<string, string> = {
  print_only: "Só impressão",
  balance: "Balanço",
  add: "Entrada",
};

interface StoreOption { id: string; name: string }
interface LabelBatch {
  id: string;
  numero: number;
  store_id: string;
  master_id: string | null;
  mode: string;
  scope: string;
  status: string;
  opened_at: string;
  applied_at: string;
  total_labels: number;
  total_delta: number;
  items_changed: number;
  created_by_name: string | null;
  reverted_at: string | null;
  reverted_by_name: string | null;
}
interface LabelBatchItem {
  id: string;
  batch_id: string;
  variant_id: string | null;
  variant_code: string | null;
  labels: number;
  counted: number | null;
  pending_expedition: number;
  moved_during_count: number;
  stock_before: number | null;
  stock_after: number | null;
  delta: number;
  skipped_reason: string | null;
}
interface VariantRow {
  id: string;
  sku: string | null;
  gtin: string | null;
  color: string | null;
  size: string | null;
  master_id: string | null;
}

const dateTime = (value: string | null) => value
  ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—";
const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

export function LabelBatchesHistory({ stores, initialStoreId }: { stores: StoreOption[]; initialStoreId?: string }) {
  const { senderName } = useTeamIdentity();
  const [storeFilter, setStoreFilter] = useState(initialStoreId || "all");
  const [period, setPeriod] = useState("30");
  const [modeFilter, setModeFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [batches, setBatches] = useState<LabelBatch[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [masterNames, setMasterNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<Record<string, LabelBatchItem[]>>({});
  const [loadingItems, setLoadingItems] = useState<string | null>(null);
  const [reprintBusy, setReprintBusy] = useState<string | null>(null);
  const [revertTarget, setRevertTarget] = useState<LabelBatch | null>(null);
  const [reverting, setReverting] = useState(false);

  const storeName = useCallback((id: string) => stores.find((s) => s.id === id)?.name || "Loja", [stores]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from("stock_label_batches")
        .select("id, numero, store_id, master_id, mode, scope, status, opened_at, applied_at, total_labels, total_delta, items_changed, created_by_name, reverted_at, reverted_by_name", { count: "exact" })
        .order("applied_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (storeFilter !== "all") query = query.eq("store_id", storeFilter);
      if (modeFilter !== "all") query = query.eq("mode", modeFilter);
      if (period !== "all") {
        const from = new Date();
        from.setDate(from.getDate() - Number(period));
        query = query.gte("applied_at", from.toISOString());
      }
      const { data, error, count } = await query;
      if (error) throw error;
      const rows = (data || []) as LabelBatch[];
      setBatches(rows);
      setTotalCount(count || 0);
      const masterIds = Array.from(new Set(rows.map((r) => r.master_id).filter(Boolean))) as string[];
      if (!masterIds.length) {
        setMasterNames({});
      } else {
        const { data: masters, error: mastersError } = await supabase.from("products_master").select("id, name").in("id", masterIds);
        if (mastersError) throw mastersError;
        setMasterNames(Object.fromEntries((masters || []).map((m) => [m.id, m.name])));
      }
    } catch (e: any) {
      toast.error("Erro ao carregar lotes: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [storeFilter, period, modeFilter, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(0); }, [storeFilter, period, modeFilter]);

  const fetchItems = useCallback(async (batchId: string) => {
    const { data, error } = await supabase.from("stock_label_batch_items")
      .select("id, batch_id, variant_id, variant_code, labels, counted, pending_expedition, moved_during_count, stock_before, stock_after, delta, skipped_reason")
      .eq("batch_id", batchId).order("variant_code").limit(200);
    if (error) throw error;
    const rows = (data || []) as LabelBatchItem[];
    setItems((current) => ({ ...current, [batchId]: rows }));
    return rows;
  }, []);

  async function toggleExpanded(batchId: string) {
    const next = !expanded[batchId];
    setExpanded((current) => ({ ...current, [batchId]: next }));
    if (!next || items[batchId]) return;
    setLoadingItems(batchId);
    try {
      await fetchItems(batchId);
    } catch (e: any) {
      toast.error("Erro ao abrir os itens: " + e.message);
    } finally {
      setLoadingItems(null);
    }
  }

  async function reprint(batch: LabelBatch) {
    setReprintBusy(batch.id);
    try {
      const batchItems = items[batch.id] || await fetchItems(batch.id);
      const printable = batchItems.filter((item) => item.labels > 0);
      if (!printable.length) { toast.error("Este lote não tem etiquetas para reimprimir."); return; }
      const variantIds = Array.from(new Set(printable.map((item) => item.variant_id).filter(Boolean))) as string[];
      const { data: variantData, error: variantsError } = variantIds.length
        ? await supabase.from("product_variants").select("id, sku, gtin, color, size, master_id").in("id", variantIds)
        : { data: [], error: null };
      if (variantsError) throw variantsError;
      const variants = (variantData || []) as VariantRow[];
      const variantMap = new Map(variants.map((v) => [v.id, v]));
      const masterIds = Array.from(new Set([
        ...variants.map((v) => v.master_id).filter(Boolean),
        batch.master_id,
      ].filter(Boolean))) as string[];
      const { data: masterData, error: mastersError } = masterIds.length
        ? await supabase.from("products_master").select("id, name, sale_price").in("id", masterIds)
        : { data: [], error: null };
      if (mastersError) throw mastersError;
      const masterMap = new Map((masterData || []).map((m) => [m.id, m]));
      const labels: LabelItem[] = printable.map((item) => {
        const variant = item.variant_id ? variantMap.get(item.variant_id) : undefined;
        const product = variant?.master_id ? masterMap.get(variant.master_id) : batch.master_id ? masterMap.get(batch.master_id) : undefined;
        return {
          id: item.variant_id || item.id,
          sku: variant?.sku || item.variant_code || "",
          gtin: variant?.gtin || null,
          color: variant?.color || null,
          size: variant?.size || null,
          code: item.variant_code,
          name: product?.name || "Produto",
          price: product?.sale_price ?? null,
          masterId: variant?.master_id || batch.master_id,
        };
      });
      const quantities = Object.fromEntries(labels.map((label, index) => [label.id, printable[index].labels]));
      printA4VariantLabels({
        items: labels,
        quantities,
        title: `Reimpressão — lote #${batch.numero}`,
        layout: undefined,
      });
    } catch (e: any) {
      toast.error("Erro ao reimprimir: " + e.message);
    } finally {
      setReprintBusy(null);
    }
  }

  async function revert() {
    if (!revertTarget) return;
    setReverting(true);
    try {
      const { data, error } = await supabase.rpc("revert_stock_label_batch", {
        p_batch_id: revertTarget.id,
        p_user_name: senderName || undefined,
      });
      if (error) throw error;
      const result = data as { reverted_items?: number; numero?: number };
      toast.success(`Lote #${result?.numero || revertTarget.numero} desfeito: ${result?.reverted_items || 0} itens revertidos.`);
      setRevertTarget(null);
      await load();
    } catch (e: any) {
      toast.error("Erro ao desfazer: " + e.message);
    } finally {
      setReverting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Printer className="h-5 w-5" /> Etiquetas e Balanços</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger><SelectValue placeholder="Loja" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map((store) => <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="all">Todo o período</SelectItem>
            </SelectContent>
          </Select>
          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os modos</SelectItem>
              <SelectItem value="print_only">Só impressão</SelectItem>
              <SelectItem value="balance">Balanço</SelectItem>
              <SelectItem value="add">Entrada</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
        ) : !batches.length ? (
          <div className="rounded border border-dashed py-12 text-center text-sm text-muted-foreground">Nenhum lote encontrado nestes filtros.</div>
        ) : (
          <div className="space-y-3">
            {batches.map((batch) => (
              <div key={batch.id} className="rounded-lg border">
                <div className="p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button className="flex min-w-0 items-start gap-2 text-left" onClick={() => void toggleExpanded(batch.id)}>
                      {expanded[batch.id] ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">Lote #{batch.numero}</span>
                          <Badge variant="secondary">{MODE_LABELS[batch.mode] || batch.mode}</Badge>
                          <Badge variant={batch.status === "applied" ? "default" : "outline"}>
                            {batch.status === "applied" ? "Aplicado" : "Desfeito"}
                          </Badge>
                        </div>
                        <div className="mt-1 truncate text-sm font-medium">
                          {batch.master_id ? masterNames[batch.master_id] || "Produto" : "Vários produtos"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {dateTime(batch.applied_at)} · {storeName(batch.store_id)} · por {batch.created_by_name || "—"}
                        </div>
                      </div>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={reprintBusy === batch.id} onClick={() => void reprint(batch)}>
                        {reprintBusy === batch.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Printer className="mr-1 h-3.5 w-3.5" />}
                        Reimprimir etiquetas
                      </Button>
                      {batch.status === "applied" && batch.mode !== "print_only" && (
                        <Button size="sm" variant="outline" onClick={() => setRevertTarget(batch)}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Desfazer
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div><span className="text-xs text-muted-foreground">Etiquetas</span><div className="font-medium">{batch.total_labels}</div></div>
                    <div><span className="text-xs text-muted-foreground">Itens alterados</span><div className="font-medium">{batch.items_changed}</div></div>
                    <div><span className="text-xs text-muted-foreground">Soma das mudanças</span><div className="font-medium">{signed(Number(batch.total_delta || 0))}</div></div>
                  </div>
                  {batch.status === "reverted" && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Desfeito por {batch.reverted_by_name || "—"} em {dateTime(batch.reverted_at)}
                    </div>
                  )}
                </div>

                {expanded[batch.id] && (
                  <div className="border-t p-3">
                    {loadingItems === batch.id ? (
                      <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[850px] text-xs">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="p-2 font-medium">Código</th>
                              <th className="p-2 text-center font-medium">Etiquetas</th>
                              <th className="p-2 text-center font-medium">Contado</th>
                              <th className="p-2 text-center font-medium">Pendentes de envio</th>
                              <th className="p-2 text-center font-medium">Vendas durante a contagem</th>
                              <th className="p-2 text-center font-medium">Saldo antes → depois</th>
                              <th className="p-2 text-center font-medium">Diferença</th>
                              <th className="p-2 font-medium">Motivo de ignorado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(items[batch.id] || []).map((item) => (
                              <tr key={item.id} className="border-b last:border-0">
                                <td className="p-2 font-mono font-medium">{item.variant_code || "—"}</td>
                                <td className="p-2 text-center">{item.labels}</td>
                                <td className="p-2 text-center">{item.counted ?? "—"}</td>
                                <td className="p-2 text-center">{item.pending_expedition}</td>
                                <td className="p-2 text-center">{item.moved_during_count}</td>
                                <td className="p-2 text-center">{item.stock_before ?? "—"} → {item.stock_after ?? "—"}</td>
                                <td className="p-2 text-center">{signed(Number(item.delta || 0))}</td>
                                <td className="p-2">{item.skipped_reason || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Página {page + 1} de {totalPages} · {totalCount} lote(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= totalCount || loading} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={!!revertTarget} onOpenChange={(value) => { if (!value && !reverting) setRevertTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer o lote #{revertTarget?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              O estoque volta pela diferença deste lote. Vendas feitas depois continuam valendo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={reverting} onClick={() => void revert()}>
              {reverting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Desfazer lote
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
