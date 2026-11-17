import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ClipboardCheck, Download, Eye, Loader2, LockKeyhole,
  Play, RefreshCw, Search, Square,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTeamIdentity } from "@/hooks/chat/useTeamIdentity";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  buildInventoryCsv, fetchAllInventoryReport, INVENTORY_STATUS_LABELS,
  runInventoryZero, type InventoryReportRow, type ZeroRunProgress,
} from "./inventoryCycleUtils";

const PAGE_SIZE = 100;
const HISTORY_PAGE_SIZE = 50;

interface StoreOption { id: string; name: string }
interface InventoryCycle {
  id: string;
  numero: number;
  store_id: string;
  name: string | null;
  status: string;
  started_at: string;
  closed_at: string | null;
  created_by_name: string | null;
  closed_by_name: string | null;
  notes: string | null;
}
interface InventorySummary {
  numero: number;
  name: string | null;
  status: string;
  store_id: string;
  store_name: string | null;
  started_at: string;
  closed_at: string | null;
  created_by_name: string | null;
  contado: number;
  impresso: number;
  nao_impresso: number;
  zerado: number;
  sem_codigo: number;
  a_zerar_itens: number;
  a_zerar_pecas_positivas: number;
  a_zerar_itens_negativos: number;
  sem_codigo_pecas: number;
  zero_unlocked: boolean;
}

const dateTime = (value: string | null) => value
  ? new Date(value).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
  : "—";

const statusVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
  if (status === "contado") return "default";
  if (status === "nao_impresso") return "outline";
  if (status === "sem_codigo") return "destructive";
  return "secondary";
};

export function InventoryCycles({ stores, initialStoreId }: { stores: StoreOption[]; initialStoreId?: string }) {
  const { senderName } = useTeamIdentity();
  const [storeId, setStoreId] = useState(initialStoreId || "");
  const [cycles, setCycles] = useState<InventoryCycle[]>([]);
  const [cyclesTotal, setCyclesTotal] = useState(0);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);
  const [selectedCycle, setSelectedCycle] = useState<InventoryCycle | null>(null);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [rows, setRows] = useState<InventoryReportRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("nao_impresso");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [loadingCycles, setLoadingCycles] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [zeroOpen, setZeroOpen] = useState(false);
  const [zeroConfirm, setZeroConfirm] = useState("");
  const [zeroRunning, setZeroRunning] = useState(false);
  const [zeroProgress, setZeroProgress] = useState<ZeroRunProgress>({ done: 0, total: 0, remaining: 0 });
  const [zeroError, setZeroError] = useState<string | null>(null);
  const stopZeroRef = useRef(false);
  const selectedCycleRef = useRef<InventoryCycle | null>(null);
  const summaryRequestRef = useRef(0);
  const reportRequestRef = useRef(0);
  selectedCycleRef.current = selectedCycle;

  useEffect(() => {
    if (initialStoreId && initialStoreId !== storeId) setStoreId(initialStoreId);
  }, [initialStoreId]); // The page-level store selector also controls this section.

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(0);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadCycles = useCallback(async (preferredId?: string | null) => {
    if (!storeId) {
      setCycles([]);
      setSelectedCycle(null);
      setLoadingCycles(false);
      return;
    }
    setLoadingCycles(true);
    try {
      const { data, error, count } = await supabase.from("stock_inventory_cycles")
        .select("id, numero, store_id, name, status, started_at, closed_at, created_by_name, closed_by_name, notes", { count: "exact" })
        .eq("store_id", storeId)
        .order("started_at", { ascending: false })
        .limit(historyLimit);
      if (error) throw error;
      const list = (data || []) as InventoryCycle[];
      setCycles(list);
      setCyclesTotal(count || 0);
      const openCycle = list.find((cycle) => cycle.status === "open") || null;
      const wantedId = preferredId !== undefined ? preferredId : selectedCycleRef.current?.id;
      const current = wantedId ? list.find((cycle) => cycle.id === wantedId) || selectedCycleRef.current : null;
      const next = current?.store_id === storeId ? current : openCycle;
      selectedCycleRef.current = next;
      setSelectedCycle(next);
      if (!next) {
        setSummary(null);
        setRows([]);
        setTotalCount(0);
      }
    } catch (error: any) {
      toast.error("Erro ao carregar inventários: " + error.message);
    } finally {
      setLoadingCycles(false);
    }
  }, [storeId, historyLimit]);

  useEffect(() => {
    selectedCycleRef.current = null;
    setSelectedCycle(null);
    setPage(0);
    setHistoryLimit(HISTORY_PAGE_SIZE);
  }, [storeId]);

  useEffect(() => { void loadCycles(); }, [loadCycles]);

  const loadSummary = useCallback(async () => {
    const cycleId = selectedCycle?.id;
    if (!cycleId) return;
    const request = ++summaryRequestRef.current;
    setLoadingSummary(true);
    try {
      const { data, error } = await (supabase.rpc as any)("stock_cycle_summary", { p_cycle_id: cycleId });
      if (error) throw error;
      if (request === summaryRequestRef.current) setSummary(data as InventorySummary);
    } catch (error: any) {
      if (request === summaryRequestRef.current) toast.error("Erro ao carregar resumo: " + error.message);
    } finally {
      if (request === summaryRequestRef.current) setLoadingSummary(false);
    }
  }, [selectedCycle?.id]);

  const loadReport = useCallback(async () => {
    const cycleId = selectedCycle?.id;
    if (!cycleId) return;
    const request = ++reportRequestRef.current;
    setLoadingReport(true);
    try {
      const { data, error } = await (supabase.rpc as any)("stock_cycle_report", {
        p_cycle_id: cycleId,
        p_status: statusFilter === "all" ? null : statusFilter,
        p_search: debouncedSearch || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      if (request === reportRequestRef.current) {
        const list = (data || []) as InventoryReportRow[];
        setRows(list);
        setTotalCount(Number(list[0]?.total_count || 0));
      }
    } catch (error: any) {
      if (request === reportRequestRef.current) toast.error("Erro ao carregar relatório: " + error.message);
    } finally {
      if (request === reportRequestRef.current) setLoadingReport(false);
    }
  }, [selectedCycle?.id, statusFilter, debouncedSearch, page]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadReport(); }, [loadReport]);
  useEffect(() => { setPage(0); }, [statusFilter]);

  function selectCycle(cycle: InventoryCycle | null) {
    selectedCycleRef.current = cycle;
    setSelectedCycle(cycle);
    setSummary(null);
    setRows([]);
    setTotalCount(0);
    setPage(0);
    setStatusFilter("nao_impresso");
    setSearchInput("");
    setDebouncedSearch("");
  }

  async function openInventory() {
    if (!storeId) return;
    setOpening(true);
    try {
      const { data, error } = await (supabase.rpc as any)("stock_cycle_open", {
        p_store_id: storeId,
        p_name: newName.trim() || null,
        p_user_name: senderName || undefined,
      });
      if (error) throw error;
      toast.success(`Inventário #${data?.numero} aberto.`);
      setNewName("");
      await loadCycles(data?.cycle_id || null);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setOpening(false);
    }
  }

  async function closeInventory() {
    if (!selectedCycle) return;
    setClosing(true);
    try {
      const { data, error } = await (supabase.rpc as any)("stock_cycle_close", {
        p_cycle_id: selectedCycle.id,
        p_user_name: senderName || undefined,
      });
      if (error) throw error;
      toast.success(`Inventário #${data?.numero || selectedCycle.numero} encerrado.`);
      setCloseOpen(false);
      await loadCycles(selectedCycle.id);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setClosing(false);
    }
  }

  async function exportCsv() {
    if (!selectedCycle) return;
    setExporting(true);
    try {
      const allRows = await fetchAllInventoryReport(async (limit, offset) => {
        const { data, error } = await (supabase.rpc as any)("stock_cycle_report", {
          p_cycle_id: selectedCycle.id,
          p_status: statusFilter === "all" ? null : statusFilter,
          p_search: debouncedSearch || null,
          p_limit: limit,
          p_offset: offset,
        });
        if (error) throw error;
        return (data || []) as InventoryReportRow[];
      });
      const blob = new Blob([buildInventoryCsv(allRows, dateTime)], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `inventario-${selectedCycle.numero}-${statusFilter}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(`${allRows.length} itens exportados.`);
    } catch (error: any) {
      toast.error("Erro ao exportar: " + error.message);
    } finally {
      setExporting(false);
    }
  }

  function showZeroDialog() {
    if (!summary) return;
    setZeroConfirm("");
    setZeroError(null);
    setZeroProgress({ done: 0, total: Number(summary.a_zerar_itens || 0), remaining: Number(summary.a_zerar_itens || 0) });
    stopZeroRef.current = false;
    setZeroOpen(true);
  }

  async function zeroUnprinted() {
    if (!selectedCycle || !summary || zeroConfirm !== "ZERAR") return;
    setZeroRunning(true);
    setZeroError(null);
    stopZeroRef.current = false;
    const total = Number(summary.a_zerar_itens || 0);

    const result = await runInventoryZero({
      cycleId: selectedCycle.id,
      userName: senderName || undefined,
      total,
      shouldStop: () => stopZeroRef.current,
      onProgress: setZeroProgress,
      rpc: (params) => (supabase.rpc as any)("stock_cycle_zero_unprinted", params),
    });

    if (result.error) {
      setZeroError(`${result.error} Já foram zerados ${result.done} de ${total} itens.`);
    } else if (result.stopped) {
      toast.info(`Zeramento interrompido: ${result.done} de ${total} itens zerados.`);
    } else if (result.noProgress) {
      setZeroError(`A última chamada não zerou nenhum item e o processo foi interrompido. Já foram zerados ${result.done} de ${total} itens; restam ${result.remaining}.`);
    } else {
      toast.success(`Zeramento concluído: ${result.done} itens zerados.`);
    }

    setZeroRunning(false);
    await Promise.all([loadSummary(), loadReport()]);
  }

  const openCycle = cycles.find((cycle) => cycle.status === "open") || null;
  const isOpen = selectedCycle?.status === "open";
  const storeName = stores.find((store) => store.id === storeId)?.name || summary?.store_name || "Loja";
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const zeroBlocked = !summary || !summary.zero_unlocked || Number(summary.contado || 0) === 0 || Number(summary.a_zerar_itens || 0) === 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Inventário</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 overflow-hidden">
        <div className="max-w-sm">
          <Select value={storeId} onValueChange={setStoreId} disabled={zeroRunning}>
            <SelectTrigger><SelectValue placeholder="Selecione a loja" /></SelectTrigger>
            <SelectContent>
              {stores.map((store) => <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!storeId ? (
          <div className="rounded border border-dashed py-12 text-center text-sm text-muted-foreground">Selecione uma loja para ver o inventário.</div>
        ) : loadingCycles && !cycles.length ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
        ) : !selectedCycle ? (
          <div className="space-y-5">
            <div className="space-y-3 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                Abra um inventário, conte a loja imprimindo etiquetas no modo Balanço e, no fim, zere o que não foi contado.
              </p>
              <div className="space-y-2">
                <Label htmlFor="inventory-name">Nome do inventário (opcional)</Label>
                <Input id="inventory-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Ex.: Contagem de novembro" />
              </div>
              <Button onClick={() => void openInventory()} disabled={opening || !!openCycle}>
                {opening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Abrir inventário
              </Button>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Inventários anteriores</h3>
              {!cycles.length ? (
                <div className="rounded border border-dashed py-8 text-center text-sm text-muted-foreground">Nenhum inventário anterior nesta loja.</div>
              ) : cycles.map((cycle) => (
                <div key={cycle.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">Inventário #{cycle.numero}</span>
                      {cycle.name && <span className="truncate">{cycle.name}</span>}
                      <Badge variant="secondary">Encerrado</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Início: {dateTime(cycle.started_at)} · Fim: {dateTime(cycle.closed_at)} · Aberto por {cycle.created_by_name || "—"}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => selectCycle(cycle)}><Eye className="mr-1 h-4 w-4" /> Ver</Button>
                </div>
              ))}
              {cycles.length < cyclesTotal && (
                <Button variant="outline" size="sm" disabled={loadingCycles} onClick={() => setHistoryLimit((value) => value + HISTORY_PAGE_SIZE)}>
                  {loadingCycles && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Carregar mais
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {!isOpen && <Button size="sm" variant="ghost" onClick={() => selectCycle(null)}><ArrowLeft className="mr-1 h-4 w-4" /> Voltar</Button>}
                    <h3 className="break-words text-lg font-semibold">
                      Inventário #{selectedCycle.numero}{selectedCycle.name ? ` — ${selectedCycle.name}` : ""} — {storeName}
                    </h3>
                    <Badge variant={isOpen ? "default" : "secondary"}>{isOpen ? "Em andamento" : "Somente leitura"}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Aberto em {dateTime(selectedCycle.started_at)} por {selectedCycle.created_by_name || "—"}
                    {selectedCycle.closed_at && ` · Encerrado em ${dateTime(selectedCycle.closed_at)} por ${selectedCycle.closed_by_name || "—"}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={loadingSummary || loadingReport || zeroRunning} onClick={() => void Promise.all([loadSummary(), loadReport()])}>
                    <RefreshCw className={cn("mr-1 h-4 w-4", (loadingSummary || loadingReport) && "animate-spin")} /> Atualizar
                  </Button>
                  {isOpen && (
                    <Button variant="outline" size="sm" disabled={zeroRunning} onClick={() => setCloseOpen(true)}>Encerrar inventário</Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {[
                  ["Contados", summary?.contado],
                  ["Etiqueta sem balanço", summary?.impresso],
                  ["Não contados", summary?.nao_impresso],
                  ["Zerados", summary?.zerado],
                  ["Sem código", summary?.sem_codigo],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md bg-muted/50 p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="mt-1 text-2xl font-semibold">{loadingSummary && !summary ? "—" : Number(value || 0)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px_auto]">
                <div className="relative min-w-0">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Nome, código, SKU ou código de barras" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="nao_impresso">Não contados</SelectItem>
                    <SelectItem value="contado">Contados</SelectItem>
                    <SelectItem value="impresso">Etiqueta sem balanço</SelectItem>
                    <SelectItem value="zerado">Zerados</SelectItem>
                    <SelectItem value="sem_codigo">Sem código</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" disabled={exporting || zeroRunning} onClick={() => void exportCsv()}>
                  {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Exportar CSV
                </Button>
              </div>

              <div className="w-full overflow-x-auto rounded-md border">
                <table className="w-full min-w-[920px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                      <th className="p-3 font-medium">Produto</th>
                      <th className="p-3 font-medium">Código</th>
                      <th className="p-3 font-medium">Cor</th>
                      <th className="p-3 font-medium">Tamanho</th>
                      <th className="p-3 text-right font-medium">Saldo no sistema</th>
                      <th className="p-3 font-medium">Situação</th>
                      <th className="p-3 text-center font-medium">Etiquetas</th>
                      <th className="p-3 font-medium">Último lote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingReport ? (
                      <tr><td colSpan={8} className="p-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
                    ) : !rows.length ? (
                      <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">Nenhum item encontrado neste filtro.</td></tr>
                    ) : rows.map((row, index) => (
                      <tr key={`${row.pos_product_id || row.variant_id || index}`} className="border-b last:border-0">
                        <td className="max-w-[280px] p-3 font-medium">{row.product_name || "—"}</td>
                        <td className="p-3">
                          <div className="font-mono text-xs">{row.code || row.sku || row.barcode || "—"}</div>
                          {row.code && (row.sku || row.barcode) && <div className="mt-0.5 text-xs text-muted-foreground">{row.sku || row.barcode}</div>}
                        </td>
                        <td className="p-3">{row.color || "—"}</td>
                        <td className="p-3">{row.size || "—"}</td>
                        <td className={cn("p-3 text-right font-semibold", Number(row.stock || 0) < 0 && "text-destructive")}>{row.stock ?? 0}</td>
                        <td className="p-3"><Badge variant={statusVariant(row.status)}>{INVENTORY_STATUS_LABELS[row.status] || row.status}</Badge></td>
                        <td className="p-3 text-center">{row.labels ?? 0}</td>
                        <td className="p-3 text-xs">
                          {row.last_batch_numero ? <><div>#{row.last_batch_numero}</div><div className="mt-0.5 text-muted-foreground">{dateTime(row.last_batch_at)}</div></> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">Página {page + 1} de {totalPages} · {totalCount} item(ns)</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0 || loadingReport} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
                  <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= totalCount || loadingReport} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
                </div>
              </div>
            </div>

            {isOpen && summary && (
              <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
                <h3 className="font-semibold">Zerar não contados</h3>
                <p className="text-sm">
                  <strong>{Number(summary.a_zerar_itens || 0)} itens serão zerados:</strong> {Number(summary.a_zerar_pecas_positivas || 0)} peças positivas vão sair do sistema e {Number(summary.a_zerar_itens_negativos || 0)} itens negativos voltam para zero.
                </p>
                {!summary.zero_unlocked && (
                  <p className="text-sm text-muted-foreground">Bloqueado: antes faça um balanço real por etiquetas e um Desfazer na tela Etiquetas e Balanços, para confirmar que tudo funciona.</p>
                )}
                {Number(summary.contado || 0) === 0 && <p className="text-sm text-muted-foreground">Conte a loja antes de zerar.</p>}
                {Number(summary.a_zerar_itens || 0) === 0 && <p className="text-sm text-muted-foreground">Não há itens não contados para zerar.</p>}
                <Button variant="destructive" disabled={zeroBlocked || zeroRunning} onClick={showZeroDialog}>
                  {zeroBlocked && <LockKeyhole className="mr-2 h-4 w-4" />} Zerar não contados
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={zeroOpen} onOpenChange={(open) => { if (!zeroRunning) setZeroOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zerar os itens não contados?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {zeroProgress.total} itens serão zerados: {Number(summary?.a_zerar_pecas_positivas || 0)} peças positivas vão sair do sistema e {Number(summary?.a_zerar_itens_negativos || 0)} itens negativos voltam para zero.
                </p>
                <p>Só zere depois de terminar a contagem da loja inteira. Itens com etiqueta impressa não são zerados. Dá para desfazer cada lote em Etiquetas e Balanços.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!zeroRunning && zeroProgress.done === 0 && !zeroError && (
            <div className="space-y-2">
              <Label htmlFor="confirm-zero">Digite ZERAR para confirmar</Label>
              <Input id="confirm-zero" value={zeroConfirm} onChange={(event) => setZeroConfirm(event.target.value)} autoComplete="off" />
            </div>
          )}
          {(zeroRunning || zeroProgress.done > 0) && (
            <div className="space-y-2">
              <Progress value={zeroProgress.total ? Math.min(100, zeroProgress.done / zeroProgress.total * 100) : 0} />
              <p className="text-sm text-muted-foreground">Zerados {zeroProgress.done} de {zeroProgress.total}{zeroRunning ? "…" : "."}</p>
            </div>
          )}
          {zeroError && <p role="alert" className="text-sm text-destructive">{zeroError}</p>}
          <AlertDialogFooter>
            {zeroRunning ? (
              <Button variant="outline" onClick={() => { stopZeroRef.current = true; }}><Square className="mr-2 h-4 w-4" /> Parar</Button>
            ) : (
              <AlertDialogCancel>{zeroProgress.done > 0 || zeroError ? "Fechar" : "Cancelar"}</AlertDialogCancel>
            )}
            {!zeroRunning && zeroProgress.done === 0 && !zeroError && (
              <Button variant="destructive" disabled={zeroConfirm !== "ZERAR"} onClick={() => void zeroUnprinted()}>Zerar agora</Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={closeOpen} onOpenChange={(open) => { if (!closing) setCloseOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar o inventário #{selectedCycle?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>Depois de encerrado, o inventário fica somente leitura.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>Cancelar</AlertDialogCancel>
            <Button disabled={closing} onClick={() => void closeInventory()}>
              {closing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Encerrar inventário
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
