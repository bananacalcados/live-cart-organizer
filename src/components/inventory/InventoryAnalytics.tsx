import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2, RefreshCw, Filter, Search, Download, X,
  Package, DollarSign, TrendingUp, Boxes, AlertTriangle, Layers,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ---------- Types ----------
type RawProduct = {
  id: string;
  store_id: string;
  tiny_id: number;
  sku: string | null;
  barcode: string | null;
  name: string;
  variant: string | null;
  size: string | null;
  color: string | null;
  category: string | null;
  price: number;
  cost_price: number;
  stock: number;
  is_active: boolean;
  updated_at: string;
};

type EnrichedProduct = RawProduct & {
  brand: string;
  parent_key: string; // chave do "produto pai" (sem tamanho/cor)
};

type SalesAgg = {
  qty: number;
  revenue: number;
};

// ---------- Helpers ----------
const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number) => v.toLocaleString("pt-BR");

function parseBrand(name: string): string {
  if (!name) return "—";
  // Padrão: "TENIS USAFLEX COURO GABI - 38 - Ouro" → "USAFLEX"
  // Heurística: pula tokens genéricos (TENIS, CHINELO, SANDALIA, BOTA, SAPATO,
  // BABUCHES, TAMANCO, RASTEIRA, MOCASSIM, BOTINHA, SAPATILHA), pega o próximo.
  const generic = new Set([
    "TENIS", "TÊNIS", "CHINELO", "SANDALIA", "SANDÁLIA", "BOTA", "SAPATO",
    "BABUCHES", "BABUCHE", "TAMANCO", "RASTEIRA", "MOCASSIM", "BOTINHA",
    "SAPATILHA", "PANTUFA", "MULE", "SLIDE", "PAPETE", "SCARPIN", "SLIPPER",
    "CASUAL", "MASCULINO", "FEMININO", "INFANTIL", "ESPORTIVO", "COURO",
  ]);
  const tokens = name.toUpperCase().split(/[\s-]+/).filter(Boolean);
  for (const t of tokens) {
    if (/^\d+$/.test(t)) continue;
    if (generic.has(t)) continue;
    if (t.length < 3) continue;
    return t;
  }
  return tokens[0] || "—";
}

function parentKey(p: RawProduct): string {
  // Tenta agrupar por SKU root (parte antes do tamanho/cor) ou pelo nome sem variação
  const baseName = p.name.split(" - ")[0]?.trim() || p.name;
  // Se SKU tem padrão "ROOT-COR-TAM", pega o root
  if (p.sku && /-/.test(p.sku)) {
    return p.sku.split("-")[0];
  }
  return baseName.toUpperCase();
}

// ---------- Component ----------
export function InventoryAnalytics() {
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<EnrichedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Filtros
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [sizeFilter, setSizeFilter] = useState<string>("all");
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<"all" | "with" | "without">("with");
  const [scopeFilter, setScopeFilter] = useState<"variants" | "parents">("variants");

  // Vendas / Curva ABC
  const [periodDays, setPeriodDays] = useState<number>(90);
  const [sales, setSales] = useState<Map<string, SalesAgg>>(new Map());
  const [loadingSales, setLoadingSales] = useState(false);

  // Carregar produtos
  async function loadProducts() {
    setLoading(true);
    setProducts([]);

    const { data: storeRows } = await supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .eq("is_simulation", false)
      .not("tiny_token", "is", null);
    setStores(storeRows || []);

    // Conta total
    const { count } = await supabase
      .from("pos_products")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    setProgress({ done: 0, total: count || 0 });

    const all: EnrichedProduct[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("pos_products")
        .select("id, store_id, tiny_id, sku, barcode, name, variant, size, color, category, price, cost_price, stock, is_active, updated_at")
        .eq("is_active", true)
        .order("id")
        .range(from, from + pageSize - 1);
      if (error) {
        toast.error("Erro ao carregar produtos: " + error.message);
        break;
      }
      if (!data || data.length === 0) break;
      for (const r of data as any[]) {
        const raw = r as RawProduct;
        all.push({
          ...raw,
          stock: Number(raw.stock || 0),
          cost_price: Number(raw.cost_price || 0),
          price: Number(raw.price || 0),
          brand: parseBrand(raw.name),
          parent_key: parentKey(raw),
        });
      }
      from += pageSize;
      setProgress({ done: all.length, total: count || all.length });
      if (data.length < pageSize) break;
    }
    setProducts(all);
    setLoading(false);
  }

  // Carregar vendas (agregado por SKU/tiny_id) no período
  async function loadSales(days: number) {
    setLoadingSales(true);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const map = new Map<string, SalesAgg>();
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("pos_sale_items")
        .select("sku, tiny_product_id, quantity, total_price, created_at")
        .gte("created_at", since.toISOString())
        .range(from, from + pageSize - 1);
      if (error) {
        toast.error("Erro ao carregar vendas: " + error.message);
        break;
      }
      if (!data || data.length === 0) break;
      for (const r of data as any[]) {
        const key = (r.sku && String(r.sku)) || (r.tiny_product_id && String(r.tiny_product_id)) || "";
        if (!key) continue;
        const cur = map.get(key) || { qty: 0, revenue: 0 };
        cur.qty += Number(r.quantity || 0);
        cur.revenue += Number(r.total_price || 0);
        map.set(key, cur);
      }
      from += pageSize;
      if (data.length < pageSize) break;
    }
    setSales(map);
    setLoadingSales(false);
  }

  useEffect(() => { loadProducts(); }, []);
  useEffect(() => { loadSales(periodDays); }, [periodDays]);

  // Listas distintas para filtros
  const brands = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => s.add(p.brand));
    return Array.from(s).sort();
  }, [products]);
  const sizes = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => p.size && s.add(p.size));
    return Array.from(s).sort((a, b) => {
      const na = parseFloat(a); const nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [products]);
  const colors = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => p.color && s.add(p.color));
    return Array.from(s).sort();
  }, [products]);
  const categories = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => p.category && s.add(p.category));
    return Array.from(s).sort();
  }, [products]);

  // Filtragem
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (storeFilter !== "all" && p.store_id !== storeFilter) return false;
      if (brandFilter !== "all" && p.brand !== brandFilter) return false;
      if (sizeFilter !== "all" && (p.size || "") !== sizeFilter) return false;
      if (colorFilter !== "all" && (p.color || "") !== colorFilter) return false;
      if (categoryFilter !== "all" && (p.category || "") !== categoryFilter) return false;
      if (stockFilter === "with" && p.stock <= 0) return false;
      if (stockFilter === "without" && p.stock > 0) return false;
      if (q && !(
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [products, search, storeFilter, brandFilter, sizeFilter, colorFilter, categoryFilter, stockFilter]);

  // Agregação pai/filho
  const aggregatedRows = useMemo(() => {
    if (scopeFilter === "variants") return filtered;
    const map = new Map<string, EnrichedProduct & { variants: number }>();
    for (const p of filtered) {
      const k = `${p.store_id}::${p.parent_key}`;
      const cur = map.get(k);
      if (cur) {
        cur.stock += p.stock;
        cur.cost_price = ((cur.cost_price * (cur.variants || 1)) + p.cost_price) / ((cur.variants || 1) + 1);
        cur.price = ((cur.price * (cur.variants || 1)) + p.price) / ((cur.variants || 1) + 1);
        cur.variants += 1;
      } else {
        map.set(k, { ...p, variants: 1 });
      }
    }
    return Array.from(map.values());
  }, [filtered, scopeFilter]);

  // KPIs
  const kpis = useMemo(() => {
    let qty = 0, cost = 0, sale = 0;
    let stagnant = 0; // sem venda no período
    for (const p of filtered) {
      qty += p.stock;
      cost += p.stock * p.cost_price;
      sale += p.stock * p.price;
      const key = (p.sku && String(p.sku)) || (p.tiny_id && String(p.tiny_id)) || "";
      if (p.stock > 0 && (!sales.get(key) || sales.get(key)!.qty === 0)) {
        stagnant += p.stock;
      }
    }
    return {
      skus: filtered.length,
      qty, cost, sale,
      margin: sale - cost,
      stagnant,
    };
  }, [filtered, sales]);

  // Curva ABC (por período) — usa filtered
  const abcRows = useMemo(() => {
    type Row = {
      key: string;
      label: string;
      qty: number;
      revenue: number;
      stock: number;
      cost: number;
      classe: "A" | "B" | "C";
      pct: number;
      cumPct: number;
    };
    const map = new Map<string, Row>();
    for (const p of filtered) {
      const key = scopeFilter === "parents"
        ? `${p.store_id}::${p.parent_key}`
        : (p.sku && String(p.sku)) || String(p.tiny_id);
      const label = scopeFilter === "parents"
        ? p.name.split(" - ")[0]
        : `${p.name}${p.size ? ` · ${p.size}` : ""}${p.color ? ` · ${p.color}` : ""}`;
      const sk = (p.sku && String(p.sku)) || String(p.tiny_id);
      const sales_ = sales.get(sk) || { qty: 0, revenue: 0 };

      const cur = map.get(key);
      if (cur) {
        cur.qty += sales_.qty;
        cur.revenue += sales_.revenue;
        cur.stock += p.stock;
        cur.cost += p.stock * p.cost_price;
      } else {
        map.set(key, {
          key, label,
          qty: sales_.qty,
          revenue: sales_.revenue,
          stock: p.stock,
          cost: p.stock * p.cost_price,
          classe: "C", pct: 0, cumPct: 0,
        });
      }
    }
    const rows = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    const total = rows.reduce((a, b) => a + b.revenue, 0) || 1;
    let cum = 0;
    for (const r of rows) {
      r.pct = (r.revenue / total) * 100;
      cum += r.pct;
      r.cumPct = cum;
      r.classe = cum <= 80 ? "A" : cum <= 95 ? "B" : "C";
    }
    return rows.filter((r) => r.revenue > 0 || r.stock > 0);
  }, [filtered, sales, scopeFilter]);

  // Produtos parados (mais antigos sem venda)
  const stagnantRows = useMemo(() => {
    return filtered
      .filter((p) => {
        if (p.stock <= 0) return false;
        const key = (p.sku && String(p.sku)) || String(p.tiny_id);
        const s = sales.get(key);
        return !s || s.qty === 0;
      })
      .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
      .slice(0, 200);
  }, [filtered, sales]);

  // Resumos por dimensão
  const byDim = (dim: keyof EnrichedProduct) => {
    const map = new Map<string, { qty: number; cost: number; sale: number; skus: number }>();
    for (const p of filtered) {
      const k = String((p as any)[dim] || "—");
      const cur = map.get(k) || { qty: 0, cost: 0, sale: 0, skus: 0 };
      cur.qty += p.stock;
      cur.cost += p.stock * p.cost_price;
      cur.sale += p.stock * p.price;
      cur.skus += 1;
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => b.cost - a.cost);
  };

  const byBrand = useMemo(() => byDim("brand"), [filtered]);
  const bySize = useMemo(() => byDim("size"), [filtered]);
  const byColor = useMemo(() => byDim("color"), [filtered]);
  const byCategory = useMemo(() => byDim("category"), [filtered]);

  function clearFilters() {
    setSearch(""); setStoreFilter("all"); setBrandFilter("all"); setSizeFilter("all");
    setColorFilter("all"); setCategoryFilter("all"); setStockFilter("with");
  }

  function exportCSV() {
    const header = ["SKU", "Nome", "Marca", "Categoria", "Tamanho", "Cor", "Loja", "Estoque", "Custo Unit", "Venda Unit", "Custo Total", "Venda Total"];
    const storeMap = new Map(stores.map((s) => [s.id, s.name]));
    const rows = filtered.map((p) => [
      p.sku || "", p.name, p.brand, p.category || "", p.size || "", p.color || "",
      storeMap.get(p.store_id) || "", String(p.stock),
      p.cost_price.toFixed(2), p.price.toFixed(2),
      (p.stock * p.cost_price).toFixed(2), (p.stock * p.price).toFixed(2),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `analise-estoque-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeFiltersCount = [
    storeFilter, brandFilter, sizeFilter, colorFilter, categoryFilter,
  ].filter((v) => v !== "all").length + (search ? 1 : 0) + (stockFilter !== "with" ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Filter className="h-5 w-5" /> Análise de Estoque
          </h2>
          <p className="text-sm text-muted-foreground">
            Filtros cruzados, curva ABC, produtos parados e cortes por marca, tamanho, cor e categoria.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => loadProducts()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} /> Recarregar
          </Button>
          <Button size="sm" variant="outline" onClick={exportCSV} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-1" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* Loading bar */}
      {loading && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando produtos: {fmtNum(progress.done)} / {fmtNum(progress.total)}
            </div>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          </CardContent>
        </Card>
      )}

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nome, SKU, código de barras..."
                className="pl-8"
              />
            </div>
            <FilterSelect label="Loja" value={storeFilter} onChange={setStoreFilter}
              options={stores.map((s) => ({ value: s.id, label: s.name }))} />
            <FilterSelect label="Marca" value={brandFilter} onChange={setBrandFilter}
              options={brands.map((b) => ({ value: b, label: b }))} />
            <FilterSelect label="Categoria" value={categoryFilter} onChange={setCategoryFilter}
              options={categories.map((c) => ({ value: c, label: c }))} />
            <FilterSelect label="Tamanho" value={sizeFilter} onChange={setSizeFilter}
              options={sizes.map((s) => ({ value: s, label: s }))} />
            <FilterSelect label="Cor" value={colorFilter} onChange={setColorFilter}
              options={colors.map((c) => ({ value: c, label: c }))} />
            <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as any)}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="with">Com estoque</SelectItem>
                <SelectItem value="without">Sem estoque</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as any)}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="variants">Produtos filhos</SelectItem>
                <SelectItem value="parents">Produtos pai</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="15">Últimos 15 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="60">Últimos 60 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="180">Últimos 180 dias</SelectItem>
                <SelectItem value="365">Últimos 365 dias</SelectItem>
              </SelectContent>
            </Select>
            {activeFiltersCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-3 w-3 mr-1" /> Limpar ({activeFiltersCount})
              </Button>
            )}
          </div>
          {loadingSales && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando vendas do período...
            </p>
          )}
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<Package className="h-4 w-4" />} label="SKUs filtrados" value={fmtNum(kpis.skus)} />
        <KpiCard icon={<Boxes className="h-4 w-4" />} label="Qtd em estoque" value={fmtNum(kpis.qty)} />
        <KpiCard icon={<DollarSign className="h-4 w-4" />} label="Custo de estoque" value={fmtMoney(kpis.cost)} />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Valor de revenda" value={fmtMoney(kpis.sale)} />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Margem potencial" value={fmtMoney(kpis.margin)} />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="Pares parados" value={fmtNum(kpis.stagnant)} />
      </div>

      {/* Abas de análise */}
      <Tabs defaultValue="abc">
        <TabsList>
          <TabsTrigger value="abc">Curva ABC</TabsTrigger>
          <TabsTrigger value="brand">Por marca</TabsTrigger>
          <TabsTrigger value="category">Por categoria</TabsTrigger>
          <TabsTrigger value="size">Por tamanho</TabsTrigger>
          <TabsTrigger value="color">Por cor</TabsTrigger>
          <TabsTrigger value="stagnant">Parados</TabsTrigger>
          <TabsTrigger value="list">Lista</TabsTrigger>
        </TabsList>

        <TabsContent value="abc">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" /> Curva ABC ({periodDays} dias) — {scopeFilter === "parents" ? "Produto Pai" : "Produto Filho"}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Cl.</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Vendas (un)</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">% Receita</TableHead>
                    <TableHead className="text-right">% Acum.</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Custo Estoque</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {abcRows.slice(0, 500).map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>
                        <Badge variant={r.classe === "A" ? "default" : r.classe === "B" ? "secondary" : "outline"}>
                          {r.classe}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate">{r.label}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.qty)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.revenue)}</TableCell>
                      <TableCell className="text-right">{r.pct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right">{r.cumPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right">{fmtNum(r.stock)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {abcRows.length > 500 && (
                <p className="text-xs text-muted-foreground mt-2">Exibindo top 500 de {fmtNum(abcRows.length)} itens.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="brand"><DimTable rows={byBrand} label="Marca" /></TabsContent>
        <TabsContent value="category"><DimTable rows={byCategory} label="Categoria" /></TabsContent>
        <TabsContent value="size"><DimTable rows={bySize} label="Tamanho" /></TabsContent>
        <TabsContent value="color"><DimTable rows={byColor} label="Cor" /></TabsContent>

        <TabsContent value="stagnant">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Produtos parados (sem venda em {periodDays} dias)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Marca</TableHead>
                    <TableHead>Tam</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Venda</TableHead>
                    <TableHead>Última atualização</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stagnantRows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-[260px] truncate">{p.name}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell>{p.brand}</TableCell>
                      <TableCell>{p.size || "—"}</TableCell>
                      <TableCell>{p.color || "—"}</TableCell>
                      <TableCell className="text-right">{fmtNum(p.stock)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.stock * p.cost_price)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.stock * p.price)}</TableCell>
                      <TableCell className="text-xs">{new Date(p.updated_at).toLocaleDateString("pt-BR")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {stagnantRows.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">Nenhum produto parado no recorte atual.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="list">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Lista detalhada — {fmtNum(aggregatedRows.length)} {scopeFilter === "parents" ? "produtos pai" : "variações"}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Marca</TableHead>
                    <TableHead>Cat.</TableHead>
                    <TableHead>Tam</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Venda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregatedRows.slice(0, 500).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-[280px] truncate">{p.name}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell>{p.brand}</TableCell>
                      <TableCell>{p.category || "—"}</TableCell>
                      <TableCell>{p.size || "—"}</TableCell>
                      <TableCell>{p.color || "—"}</TableCell>
                      <TableCell className="text-right">{fmtNum(p.stock)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.stock * p.cost_price)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.stock * p.price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {aggregatedRows.length > 500 && (
                <p className="text-xs text-muted-foreground mt-2">Exibindo top 500. Use filtros pra reduzir o recorte ou exporte CSV.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[160px] h-9">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        <SelectItem value="all">Todas as {label.toLowerCase()}s</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
          <span>{label}</span>{icon}
        </div>
        <div className="text-lg font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function DimTable({ rows, label }: { rows: any[]; label: string }) {
  const total = rows.reduce((a, b) => a + b.cost, 0) || 1;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Estoque por {label}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{label}</TableHead>
              <TableHead className="text-right">SKUs</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead className="text-right">Venda</TableHead>
              <TableHead className="text-right">% Custo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-medium">{r.key}</TableCell>
                <TableCell className="text-right">{r.skus.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right">{r.qty.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right">{r.cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                <TableCell className="text-right">{r.sale.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                <TableCell className="text-right">{((r.cost / total) * 100).toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
