import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2, RefreshCw, Search, AlertTriangle, GitMerge, Layers, PackageX,
  Trash2, CheckCircle2, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

interface Summary {
  nao_catalogados: number;
  sem_gtin: number;
  pais_fragmentados: number;
}

interface VariantRow {
  sku: string;
  barcode: string | null;
  color: string | null;
  size: string | null;
  store_count: number;
  divergent_stock_sum: number;
  correct_sku: string | null;
  correct_barcode: string | null;
}

interface ParentGroup {
  parent_sku: string;
  parent_name: string;
  has_master: boolean;
  total_divergent_variants: number;
  total_divergent_stock: number;
  variants: VariantRow[] | null;
}

const PAGE_SIZE = 30;

export function InventoryPosDivergences() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [groups, setGroups] = useState<ParentGroup[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ pais_a_criar: number; variacoes_a_reagrupar: number } | null>(null);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    const { data, error } = await (supabase.rpc as any)("pos_estoque_divergence_summary");
    if (error) toast.error("Erro ao carregar resumo: " + error.message);
    else setSummary(data as Summary);
    setLoadingSummary(false);
  }, []);

  const loadGroups = useCallback(async (p: number, s: string) => {
    setLoading(true);
    const { data, error } = await (supabase.rpc as any)("list_pos_estoque_divergences_grouped", {
      p_search: s || null,
      p_limit: PAGE_SIZE,
      p_offset: p * PAGE_SIZE,
    });
    if (error) toast.error("Erro ao carregar divergências: " + error.message);
    else setGroups((data as ParentGroup[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSummary();
    loadGroups(0, "");
  }, [loadSummary, loadGroups]);

  const runSearch = () => {
    setPage(0);
    loadGroups(0, search);
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
    loadGroups(page, search);
  };

  // Remove localmente sem recarregar tudo
  const patchGroupAfterDelete = (parent_sku: string, deletedBarcodes: string[]) => {
    setGroups((prev) =>
      prev
        .map((g) => {
          if (g.parent_sku !== parent_sku) return g;
          const remaining = (g.variants ?? []).filter(
            (v) => !deletedBarcodes.includes(v.barcode || ""),
          );
          return {
            ...g,
            variants: remaining,
            total_divergent_variants: remaining.length,
            total_divergent_stock: remaining.reduce(
              (a, v) => a + (v.divergent_stock_sum || 0),
              0,
            ),
          };
        })
        .filter((g) => (g.variants?.length ?? 0) > 0),
    );
  };

  const deleteVariant = async (parent_sku: string, v: VariantRow) => {
    if (!v.correct_barcode) {
      toast.error("Sem cadastro correto irmão. Rode Unificar primeiro.");
      return;
    }
    const key = `${parent_sku}::${v.barcode}`;
    setDeletingKey(key);
    const { data, error } = await (supabase.rpc as any)("delete_pos_divergent_variant", {
      p_parent_sku: parent_sku,
      p_barcode: v.barcode,
    });
    setDeletingKey(null);
    if (error) {
      toast.error("Erro ao excluir: " + error.message);
      return;
    }
    toast.success(
      `Excluído · ${data?.rows_deleted ?? 0} cadastros em ${data?.stores_affected ?? 0} lojas · ${data?.stock_migrated ?? 0} par(es) migrado(s) para ${data?.correct_barcode}`,
      { duration: 7000 },
    );
    patchGroupAfterDelete(parent_sku, [v.barcode || ""]);
    loadSummary();
  };

  const deleteParent = async (g: ParentGroup) => {
    const key = `parent::${g.parent_sku}`;
    setDeletingKey(key);
    const { data, error } = await (supabase.rpc as any)("delete_pos_divergent_parent", {
      p_parent_sku: g.parent_sku,
    });
    setDeletingKey(null);
    if (error) {
      toast.error("Erro ao excluir: " + error.message);
      return;
    }
    toast.success(
      `${data?.rows_deleted ?? 0} cadastros removidos · ${data?.stock_migrated ?? 0} par(es) migrado(s) · ${data?.variants_skipped ?? 0} variações puladas (sem irmão correto)`,
      { duration: 8000 },
    );
    // recarrega só este pai
    loadGroups(page, search);
    loadSummary();
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
            Produtos que existem no PDV (Frente de Caixa) mas não estão vinculados ao Módulo Estoque. Agrupados por produto pai.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { loadSummary(); loadGroups(page, search); }}>
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
                    <p>Esta ação reagrupa variações sob o produto pai correto e remove pais fragmentados vazios.</p>
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

      {/* Search */}
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

      {/* Grouped list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhuma divergência encontrada. 🎉
            </div>
          ) : (
            <Accordion type="multiple" className="w-full">
              {groups.map((g) => {
                const hasResolvable = (g.variants ?? []).some((v) => v.correct_barcode);
                return (
                  <AccordionItem key={g.parent_sku} value={g.parent_sku}>
                    <div className="flex items-center gap-2 pr-3">
                      <AccordionTrigger className="flex-1 px-4 hover:no-underline">
                        <div className="flex items-center gap-3 text-left w-full">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{g.parent_name || g.parent_sku}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              ref: {g.parent_sku}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {g.has_master ? (
                              <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> tem pai no Estoque
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                <ShieldAlert className="h-3 w-3 mr-1" /> sem pai no Estoque
                              </Badge>
                            )}
                            <Badge variant="secondary">{g.total_divergent_variants} variações</Badge>
                            {g.total_divergent_stock > 0 && (
                              <Badge variant="destructive">{g.total_divergent_stock} par(es) órfãos</Badge>
                            )}
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={!hasResolvable || deletingKey === `parent::${g.parent_sku}`}
                            title={hasResolvable ? "Excluir todos divergentes deste pai" : "Nenhuma variação tem cadastro correto irmão"}
                          >
                            {deletingKey === `parent::${g.parent_sku}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir todos os cadastros duplicados de "{g.parent_name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Vamos remover as variações divergentes deste pai e migrar o estoque para o cadastro correto (o irmão vinculado ao Módulo Estoque). Variações sem cadastro correto são puladas — use "Unificar" antes.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteParent(g)}>Confirmar exclusão</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <AccordionContent className="pb-3">
                      <div className="px-4">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Cor</TableHead>
                              <TableHead>Tam.</TableHead>
                              <TableHead>Barcode divergente</TableHead>
                              <TableHead>SKU divergente</TableHead>
                              <TableHead className="text-right">Lojas</TableHead>
                              <TableHead className="text-right">Estoque órfão</TableHead>
                              <TableHead>Cadastro correto (irmão)</TableHead>
                              <TableHead className="text-right">Ação</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(g.variants ?? []).map((v) => {
                              const key = `${g.parent_sku}::${v.barcode}`;
                              const canDelete = !!v.correct_barcode;
                              return (
                                <TableRow key={`${v.sku}-${v.barcode}`}>
                                  <TableCell>{v.color || "-"}</TableCell>
                                  <TableCell>{v.size || "-"}</TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {v.barcode ? (
                                      v.barcode
                                    ) : (
                                      <Badge variant="destructive" className="text-[10px]">sem GTIN</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                                  <TableCell className="text-right">{v.store_count}</TableCell>
                                  <TableCell className="text-right">
                                    {v.divergent_stock_sum > 0 ? (
                                      <span className="text-destructive font-semibold">{v.divergent_stock_sum}</span>
                                    ) : (
                                      <span className="text-muted-foreground">0</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {v.correct_barcode ? (
                                      <div className="text-xs">
                                        <div className="font-mono">{v.correct_barcode}</div>
                                        <div className="text-muted-foreground font-mono">{v.correct_sku}</div>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">nenhum encontrado</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={!canDelete || deletingKey === key}
                                          title={canDelete ? "Excluir divergente e migrar estoque" : "Sem cadastro correto irmão"}
                                        >
                                          {deletingKey === key ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                          ) : (
                                            <Trash2 className="h-3 w-3" />
                                          )}
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Excluir cadastro duplicado?</AlertDialogTitle>
                                          <AlertDialogDescription asChild>
                                            <div className="space-y-2 text-sm">
                                              <div>Divergente: <span className="font-mono">{v.sku}</span> ({v.barcode})</div>
                                              <div>Cor/Tamanho: <strong>{v.color} · {v.size}</strong></div>
                                              <div>Lojas afetadas: <strong>{v.store_count}</strong></div>
                                              <div>Estoque a migrar: <strong>{v.divergent_stock_sum} par(es)</strong></div>
                                              <div className="pt-2 border-t">
                                                Cadastro correto que receberá o estoque:
                                                <div className="font-mono text-xs mt-1">{v.correct_sku} · {v.correct_barcode}</div>
                                              </div>
                                            </div>
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => deleteVariant(g.parent_sku, v)}>
                                            Confirmar exclusão
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
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
            onClick={() => { const p = page - 1; setPage(p); loadGroups(p, search); }}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={groups.length < PAGE_SIZE || loading}
            onClick={() => { const p = page + 1; setPage(p); loadGroups(p, search); }}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}

export default InventoryPosDivergences;
