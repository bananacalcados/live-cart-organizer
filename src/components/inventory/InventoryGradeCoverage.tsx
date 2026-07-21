import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Search, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeParentSummaries, healthBucket, parseSizeFromName, getGradeRange,
  type ParentSummary, type VariantRow, type LegacyParentMeta,
} from "@/lib/gradeCoverage";

type Category = { id: string; name: string };
type Store = { id: string; name: string };

const GENDERS = [
  { value: "feminino", label: "Feminino" },
  { value: "masculino", label: "Masculino" },
  { value: "unissex", label: "Unissex" },
  { value: "infantil", label: "Infantil" },
];

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const fixed = (value: unknown, digits = 2) => toNumber(value).toFixed(digits);

const fmtNum = (v: number) => toNumber(v).toLocaleString("pt-BR");
const fmtMoney = (v: number) =>
  toNumber(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function InventoryGradeCoverage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [legacyMap, setLegacyMap] = useState<Map<string, LegacyParentMeta>>(new Map());
  const [loading, setLoading] = useState(true);

  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [genderFilter, setGenderFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "complete" | "broken" | "critical">("all");
  const [modalCatId, setModalCatId] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    const [cats, st] = await Promise.all([
      supabase.from("product_categories").select("id, name").order("name"),
      supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name"),
    ]);
    setCategories((cats.data as any) || []);
    setStores((st.data as any) || []);
  }, []);

  const loadLegacy = useCallback(async () => {
    // Load ALL Legacy masters + variants and build a parent_sku (=sku_root) map.
    const pageSize = 1000;
    let from = 0;
    const masters: any[] = [];
    while (true) {
      const { data, error } = await supabase
        .from("products_master")
        .select("id, sku_root, name, category_id, gender, is_active")
        .eq("is_active", true)
        .range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) break;
      masters.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    const idToRoot = new Map<string, string>();
    for (const m of masters) if (m.sku_root) idToRoot.set(m.id, m.sku_root);

    // Variants — collect real sizes per master.
    from = 0;
    const variantSizes = new Map<string, Set<number>>(); // sku_root -> sizes
    while (true) {
      const { data, error } = await supabase
        .from("product_variants")
        .select("master_id, size, is_active")
        .eq("is_active", true)
        .range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) break;
      for (const v of data as any[]) {
        const root = idToRoot.get(v.master_id);
        if (!root) continue;
        const n = Number(v.size);
        if (!Number.isFinite(n)) continue;
        const set = variantSizes.get(root) || new Set<number>();
        set.add(n);
        variantSizes.set(root, set);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }

    const map = new Map<string, LegacyParentMeta>();
    for (const m of masters) {
      if (!m.sku_root) continue;
      map.set(m.sku_root, {
        displayName: m.name,
        category_id: m.category_id,
        gender: m.gender,
        variantSizes: Array.from(variantSizes.get(m.sku_root) || []),
      });
    }
    setLegacyMap(map);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const pageSize = 1000;
    let from = 0;
    const all: VariantRow[] = [];
    while (true) {
      const { data, error } = await supabase
        .from("pos_products")
        .select("parent_sku, name, stock, price, cost_price, category_id, gender, store_id, sku")
        .range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) break;
      all.push(...(data as any[]).map((r) => ({
        ...r,
        stock: toNumber(r.stock),
        price: toNumber(r.price),
        cost_price: toNumber(r.cost_price),
      })));
      if (data.length < pageSize) break;
      from += pageSize;
    }
    setRows(all);
    setLoading(false);
  }, []);

  useEffect(() => { loadMeta(); loadLegacy(); loadData(); }, [loadMeta, loadLegacy, loadData]);

  // Apply filters BEFORE grouping (store filter affects which variants count).
  // NOTE: gender/category filters use Legacy metadata when the parent exists in
  // Legacy, so filtering is consistent with what's displayed.
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (storeFilter !== "all" && r.store_id !== storeFilter) return false;
      const legacy = r.parent_sku ? legacyMap.get(r.parent_sku) : undefined;
      const gender = legacy?.gender ?? r.gender ?? "";
      const category = legacy?.category_id ?? r.category_id;
      if (genderFilter !== "all" && gender !== genderFilter) return false;
      if (categoryFilter !== "all" && category !== categoryFilter) return false;
      return true;
    });
  }, [rows, storeFilter, genderFilter, categoryFilter, legacyMap]);

  // Only include products registered in Legacy — hides ghost pos_products rows.
  const allSummaries = useMemo(
    () => computeParentSummaries(filteredRows, { legacyMap, onlyLegacy: true }),
    [filteredRows, legacyMap],
  );
  // Exclude parents with zero total stock — likely discontinued, not a health signal.
  const summaries = useMemo(() => allSummaries.filter(p => p.totalPairs > 0), [allSummaries]);
  const inactiveSummaries = useMemo(() => allSummaries.filter(p => p.totalPairs === 0), [allSummaries]);

  // parent_sku -> Map<size, totalStock> for the grade detail modal
  const stockBySize = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    for (const r of filteredRows) {
      const key = r.parent_sku || `__${r.name || "?"}`;
      const size = parseSizeFromName(r.name);
      if (size == null) continue;
      const stk = Number(r.stock ?? 0);
      const inner = m.get(key) || new Map<number, number>();
      inner.set(size, (inner.get(size) || 0) + stk);
      m.set(key, inner);
    }
    return m;
  }, [filteredRows]);

  const modalCategory = useMemo(() => {
    if (!modalCatId) return null;
    if (modalCatId === "__inactive__") {
      const parents = inactiveSummaries
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      return { name: "Inativos (grade zerada)", parents };
    }
    const name = modalCatId === "uncat"
      ? "Sem categoria"
      : categories.find(c => c.id === modalCatId)?.name || "—";
    const parents = summaries
      .filter(p => (p.category_id || "uncat") === modalCatId)
      .sort((a, b) => a.coveragePct - b.coveragePct || a.displayName.localeCompare(b.displayName));
    return { name, parents };
  }, [modalCatId, summaries, inactiveSummaries, categories]);

  // ===== Visualization 1: Health Score per category =====
  type CatHealth = {
    catId: string; name: string;
    total: number; complete: number; broken: number; critical: number;
    pairs: number; holes: number;
  };
  const categoryHealth = useMemo<CatHealth[]>(() => {
    const map = new Map<string, CatHealth>();
    for (const p of summaries) {
      const id = p.category_id || "uncat";
      const name = categories.find(c => c.id === id)?.name || "Sem categoria";
      const cur = map.get(id) || { catId: id, name, total: 0, complete: 0, broken: 0, critical: 0, pairs: 0, holes: 0 };
      cur.total++;
      cur.pairs += p.totalPairs;
      cur.holes += p.missingSizes.length;
      const b = healthBucket(p.coveragePct, p.isComplete);
      if (b === "complete") cur.complete++;
      else if (b === "broken") cur.broken++;
      else cur.critical++;
      map.set(id, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [summaries, categories]);

  // ===== Visualization 2: Category × Gender matrix (% complete) =====
  type MatrixCell = { total: number; complete: number; broken: number; critical: number; pairs: number };
  const matrix = useMemo(() => {
    const m = new Map<string, MatrixCell>();
    for (const p of summaries) {
      const cat = p.category_id || "uncat";
      const gen = p.gender || "—";
      const k = `${cat}|${gen}`;
      const cur = m.get(k) || { total: 0, complete: 0, broken: 0, critical: 0, pairs: 0 };
      cur.total++;
      cur.pairs += p.totalPairs;
      const b = healthBucket(p.coveragePct, p.isComplete);
      if (b === "complete") cur.complete++;
      else if (b === "broken") cur.broken++;
      else cur.critical++;
      m.set(k, cur);
    }
    return m;
  }, [summaries]);

  const matrixRows = useMemo(() => {
    const set = new Set<string>();
    for (const k of matrix.keys()) set.add(k.split("|")[0]);
    const arr = Array.from(set).map(catId => ({
      catId, name: categories.find(c => c.id === catId)?.name || "Sem categoria",
    }));
    arr.sort((a, b) => a.name.localeCompare(b.name));
    return arr;
  }, [matrix, categories]);

  // ===== Visualization 4: Holes drill-down =====
  const holes = useMemo(() => {
    let list = summaries.filter(p => !p.isComplete);
    if (statusFilter === "broken") list = list.filter(p => p.coveragePct >= 50);
    else if (statusFilter === "critical") list = list.filter(p => p.coveragePct < 50);
    else if (statusFilter === "complete") list = summaries.filter(p => p.isComplete);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.displayName.toLowerCase().includes(q) || p.parent_sku.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => b.totalPairs - a.totalPairs);
  }, [summaries, statusFilter, search]);

  const totals = useMemo(() => {
    const total = summaries.length;
    let complete = 0, broken = 0, critical = 0, holesCount = 0;
    for (const p of summaries) {
      const b = healthBucket(p.coveragePct, p.isComplete);
      if (b === "complete") complete++;
      else if (b === "broken") broken++;
      else critical++;
      holesCount += p.missingSizes.length;
    }
    return { total, complete, broken, critical, holesCount };
  }, [summaries]);

  const exportHoles = useCallback(() => {
    const header = ["parent_sku", "nome", "categoria", "genero", "pares_estoque", "valor_venda", "tamanhos_faltando", "cobertura_%"];
    const lines = [header.join(";")];
    for (const p of holes) {
      const cat = categories.find(c => c.id === p.category_id)?.name || "Sem categoria";
      lines.push([
        p.parent_sku,
        `"${p.displayName.replace(/"/g, '""')}"`,
        cat,
        p.gender || "",
        p.totalPairs,
        fixed(p.saleValue),
        p.missingSizes.join("/"),
        fixed(p.coveragePct, 0),
      ].join(";"));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `furos-grade-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [holes, categories]);

  return (
    <div className="space-y-6">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">Cobertura de Grade</h3>
          <p className="text-sm text-muted-foreground">
            % de grade completa, furos por categoria e drill-down dos modelos com tamanho zerado.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Loja" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={genderFilter} onValueChange={setGenderFilter}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Gênero" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos gêneros</SelectItem>
              {GENDERS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} /> Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiMini label="Modelos (pais)" value={fmtNum(totals.total)} loading={loading} />
        <KpiMini label="Grade completa" value={fmtNum(totals.complete)} tone="ok"
          sub={totals.total ? `${fixed((totals.complete / totals.total) * 100, 0)}%` : "—"} loading={loading} />
        <KpiMini label="Grade quebrada" value={fmtNum(totals.broken)} tone="warn"
          sub={totals.total ? `${fixed((totals.broken / totals.total) * 100, 0)}%` : "—"} loading={loading} />
        <KpiMini label="Crítico (<50%)" value={fmtNum(totals.critical)} tone="bad"
          sub={totals.total ? `${fixed((totals.critical / totals.total) * 100, 0)}%` : "—"} loading={loading} />
        <KpiMini label="Total de furos" value={fmtNum(totals.holesCount)} tone="warn" loading={loading} />
      </div>

      {/* 1. Health Score per category */}
      <Card>
        <CardHeader><CardTitle className="text-base">Saúde por categoria</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {categoryHealth.map(c => {
                const completePct = c.total ? (c.complete / c.total) * 100 : 0;
                const brokenPct = c.total ? (c.broken / c.total) * 100 : 0;
                const criticalPct = c.total ? (c.critical / c.total) * 100 : 0;
                return (
                  <Card key={c.catId} className="border-muted">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold">{c.name}</span>
                        <button
                          type="button"
                          onClick={() => setModalCatId(c.catId)}
                          className="rounded-full"
                        >
                          <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                            {fmtNum(c.total)} modelos
                          </Badge>
                        </button>
                      </div>
                      <div className="text-2xl font-bold mb-2">
                        {fixed(completePct, 0)}% <span className="text-xs font-normal text-muted-foreground">grade completa</span>
                      </div>
                      <div className="flex h-2 rounded-full overflow-hidden mb-2 bg-muted">
                        <div className="bg-emerald-500" style={{ width: `${completePct}%` }} />
                        <div className="bg-amber-500" style={{ width: `${brokenPct}%` }} />
                        <div className="bg-destructive" style={{ width: `${criticalPct}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> {c.complete}</span>
                        <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" /> {c.broken}</span>
                        <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-destructive" /> {c.critical}</span>
                        <span>{fmtNum(c.holes)} furos</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Category × Gender matrix */}
      <Card>
        <CardHeader><CardTitle className="text-base">Matriz Categoria × Gênero (% grade completa)</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Categoria</TableHead>
                    {GENDERS.map(g => (
                      <TableHead key={g.value} className="text-center">{g.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrixRows.map(r => (
                    <TableRow key={r.catId}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      {GENDERS.map(g => {
                        const cell = matrix.get(`${r.catId}|${g.value}`);
                        if (!cell || cell.total === 0) {
                          return <TableCell key={g.value} className="text-center text-muted-foreground/40">—</TableCell>;
                        }
                        const pct = (cell.complete / cell.total) * 100;
                        const bg =
                          pct >= 80 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : pct >= 50 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "bg-destructive/15 text-destructive";
                        return (
                          <TableCell key={g.value} className="text-center">
                            <div className={cn("rounded-md py-1 px-2 inline-flex flex-col items-center min-w-[80px]", bg)}>
                              <span className="font-bold">{fixed(pct, 0)}%</span>
                              <span className="text-[10px] opacity-80">
                                {cell.complete}/{cell.total} · {fmtNum(cell.pairs)} pares
                              </span>
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Holes drill-down */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Modelos com furos na grade</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou SKU..."
                  className="pl-8 h-9 w-56"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos com furo</SelectItem>
                  <SelectItem value="broken">Só quebrada (≥50%)</SelectItem>
                  <SelectItem value="critical">Só crítico (&lt;50%)</SelectItem>
                  <SelectItem value="complete">Só completa</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportHoles} disabled={!holes.length}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Gênero</TableHead>
                    <TableHead>Cobertura</TableHead>
                    <TableHead>Tamanhos faltando</TableHead>
                    <TableHead className="text-right">Pares</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holes.slice(0, 500).map(p => {
                    const cat = categories.find(c => c.id === p.category_id)?.name || "Sem categoria";
                    return (
                      <TableRow key={p.parent_sku}>
                        <TableCell>
                          <div className="font-medium text-sm">{p.displayName}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{p.parent_sku}</div>
                        </TableCell>
                        <TableCell><Badge variant="outline">{cat}</Badge></TableCell>
                        <TableCell className="capitalize text-sm">{p.gender || "—"}</TableCell>
                        <TableCell className="min-w-[140px]">
                          <div className="flex items-center gap-2">
                            <Progress value={p.coveragePct} className="h-1.5 w-20" />
                            <span className="text-xs font-medium">{fixed(p.coveragePct, 0)}%</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {p.presentSizes.length}/{p.expectedSizes.length} tamanhos
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {p.missingSizes.length === 0 ? (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700">Completa</Badge>
                            ) : p.missingSizes.map(s => (
                              <Badge key={s} variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{fmtNum(p.totalPairs)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(p.saleValue)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {holes.length > 500 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Mostrando 500 de {fmtNum(holes.length)} modelos. Refine os filtros ou exporte em CSV.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Inativos (grade totalmente zerada) ===== */}
      <Card className="border-muted">
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-base">Inativos · grade totalmente zerada</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Modelos sem nenhum par em estoque — provavelmente descontinuados. <strong>Não entram</strong> no cálculo de saúde.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalCatId("__inactive__")}
              disabled={inactiveSummaries.length === 0}
            >
              Ver {fmtNum(inactiveSummaries.length)} modelos
            </Button>
          </div>
        </CardHeader>
      </Card>


      <Dialog open={!!modalCatId} onOpenChange={(o) => !o && setModalCatId(null)}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b">
            <DialogTitle className="text-lg">
              {modalCategory?.name}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · {modalCategory?.parents.length || 0} modelos
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            <div className="space-y-3">
              {modalCategory?.parents.map((p) => {
                const sizeMap = stockBySize.get(p.parent_sku) || new Map<number, number>();
                const range = p.expectedSizes.length > 0 ? p.expectedSizes : getGradeRange(p.gender);
                const bucket = healthBucket(p.coveragePct, p.isComplete);
                return (
                  <div key={p.parent_sku} className="border rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm break-words whitespace-normal">
                          {p.displayName}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5 break-all">
                          {p.parent_sku} {p.gender && <span className="capitalize">· {p.gender}</span>}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0",
                          bucket === "complete" && "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
                          bucket === "broken" && "bg-amber-500/10 text-amber-700 border-amber-500/30",
                          bucket === "critical" && "bg-destructive/10 text-destructive border-destructive/30",
                        )}
                      >
                        {fixed(p.coveragePct, 0)}% · {fmtNum(p.totalPairs)} pares
                      </Badge>
                    </div>
                    <div className="overflow-x-auto -mx-1 px-1 pb-1">
                      <div className="flex gap-1 w-max">
                        {range.map((sz) => {
                          const qty = sizeMap.get(sz) || 0;
                          const zero = qty <= 0;
                          return (
                            <div
                              key={sz}
                              className={cn(
                                "flex flex-col items-center min-w-[48px] rounded-md border py-1.5",
                                zero
                                  ? "bg-destructive/5 border-destructive/30 text-destructive"
                                  : "bg-emerald-500/5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
                              )}
                            >
                              <span className="text-xs font-semibold">{sz}</span>
                              <span className="text-base font-bold leading-tight">{qty}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
              {modalCategory && modalCategory.parents.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Nenhum modelo nesta categoria.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiMini({
  label, value, sub, tone, loading,
}: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad"; loading?: boolean }) {
  return (
    <Card className={cn(
      tone === "ok" && "border-emerald-500/30",
      tone === "warn" && "border-amber-500/30",
      tone === "bad" && "border-destructive/30",
    )}>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mt-1" /> : (
          <div className="flex items-baseline gap-2">
            <div className="text-xl font-bold">{value}</div>
            {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
