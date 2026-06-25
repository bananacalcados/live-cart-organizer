import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, RefreshCw, Search, AlertTriangle, GitMerge, Layers, PackageX } from "lucide-react";
import { toast } from "sonner";

interface Summary {
  nao_catalogados: number;
  sem_gtin: number;
  pais_fragmentados: number;
}

interface DivergenceRow {
  parent_sku: string;
  name: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  category: string | null;
  store_count: number;
  sem_gtin: boolean;
}

const PAGE_SIZE = 100;

export function InventoryPosDivergences() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<DivergenceRow[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [preview, setPreview] = useState<{ pais_a_criar: number; variacoes_a_reagrupar: number } | null>(null);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    const { data, error } = await (supabase.rpc as any)("pos_estoque_divergence_summary");
    if (error) toast.error("Erro ao carregar resumo: " + error.message);
    else setSummary(data as Summary);
    setLoadingSummary(false);
  }, []);

  const loadRows = useCallback(async (p: number, s: string) => {
    setLoading(true);
    const { data, error } = await (supabase.rpc as any)("list_pos_estoque_divergences", {
      p_search: s || null,
      p_limit: PAGE_SIZE,
      p_offset: p * PAGE_SIZE,
    });
    if (error) toast.error("Erro ao carregar divergências: " + error.message);
    else setRows((data as DivergenceRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSummary();
    loadRows(0, "");
  }, [loadSummary, loadRows]);

  const runSearch = () => {
    setPage(0);
    loadRows(0, search);
  };

  const loadPreview = async () => {
    const { data, error } = await (supabase.rpc as any)("consolidate_estoque_parents_by_pos", { p_commit: false });
    if (error) {
      toast.error("Erro no preview: " + error.message);
      return;
    }
    setPreview({
      pais_a_criar: data?.pais_a_criar ?? 0,
      variacoes_a_reagrupar: data?.variacoes_a_reagrupar ?? 0,
    });
  };

  const runConsolidation = async () => {
    setConsolidating(true);
    const { data, error } = await (supabase.rpc as any)("consolidate_estoque_parents_by_pos", { p_commit: true });
    setConsolidating(false);
    if (error) {
      toast.error("Erro na consolidação: " + error.message);
      return;
    }
    toast.success(
      `Consolidado: ${data?.pais_criados ?? 0} pais criados, ${data?.variacoes_reagrupadas ?? 0} variações reagrupadas, ${data?.pais_vazios_removidos ?? 0} pais vazios removidos`,
      { duration: 8000 }
    );
    setPreview(null);
    loadSummary();
    loadRows(page, search);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Divergências PDV → Estoque
          </h2>
          <p className="text-sm text-muted-foreground">
            Produtos que existem no PDV (Frente de Caixa) mas ainda não estão catalogados no Módulo Estoque.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { loadSummary(); loadRows(page, search); }}>
          <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
              <PackageX className="h-4 w-4" /> Não catalogados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loadingSummary ? <Loader2 className="h-5 w-5 animate-spin" /> : summary?.nao_catalogados ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">no PDV, ausentes no Estoque</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
              <AlertTriangle className="h-4 w-4" /> Sem código de barras
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loadingSummary ? <Loader2 className="h-5 w-5 animate-spin" /> : summary?.sem_gtin ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">precisam de GTIN para casar</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
              <Layers className="h-4 w-4" /> Pais fragmentados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loadingSummary ? <Loader2 className="h-5 w-5 animate-spin" /> : summary?.pais_fragmentados ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">modelos divididos por cor/tamanho</p>
          </CardContent>
        </Card>
      </div>

      {/* Consolidation action */}
      <Card className="border-primary/30">
        <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <GitMerge className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold">Consolidar pais fragmentados</p>
              <p className="text-xs text-muted-foreground">
                Reagrupa as variações sob o produto pai correto (modelo), usando a referência do PDV.
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" onClick={loadPreview}>
                <GitMerge className="h-4 w-4 mr-1" /> Consolidar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Consolidar pais por referência?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>Esta ação reagrupa variações sob o produto pai correto e remove pais fragmentados vazios. Marcados para revisão.</p>
                    {preview ? (
                      <div className="rounded-md bg-muted p-3 text-sm text-foreground">
                        <div>Pais a criar: <strong>{preview.pais_a_criar}</strong></div>
                        <div>Variações a reagrupar: <strong>{preview.variacoes_a_reagrupar}</strong></div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Calculando impacto...</div>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={runConsolidation} disabled={consolidating}>
                  {consolidating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  Confirmar consolidação
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Search + list */}
      <div className="flex gap-2">
        <Input
          placeholder="Buscar por nome, SKU, código de barras ou referência..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
        />
        <Button variant="outline" onClick={runSearch}>
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhuma divergência encontrada. 🎉
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Tam.</TableHead>
                  <TableHead>Cor</TableHead>
                  <TableHead>Cód. barras</TableHead>
                  <TableHead>Referência (pai)</TableHead>
                  <TableHead className="text-right">Lojas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.parent_sku}-${r.sku}`}>
                    <TableCell className="font-medium max-w-[280px] truncate">{r.name}</TableCell>
                    <TableCell>{r.size || "-"}</TableCell>
                    <TableCell>{r.color || "-"}</TableCell>
                    <TableCell>
                      {r.sem_gtin ? (
                        <Badge variant="destructive" className="text-[10px]">sem GTIN</Badge>
                      ) : (
                        <span className="font-mono text-xs">{r.barcode}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground max-w-[200px] truncate">
                      {r.parent_sku}
                    </TableCell>
                    <TableCell className="text-right">{r.store_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Página {page + 1}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => { const p = page - 1; setPage(p); loadRows(p, search); }}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length < PAGE_SIZE || loading}
            onClick={() => { const p = page + 1; setPage(p); loadRows(p, search); }}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}

export default InventoryPosDivergences;
