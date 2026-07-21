import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, Activity, AlertTriangle, Boxes, Package, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryGradeCoverage } from "./InventoryGradeCoverage";
import { InventoryHealthScoreCard } from "./InventoryHealthScoreCard";

type Category = { id: string; name: string; slug: string };
type PriceTier = { id: string; label: string; min_price: number | null; max_price: number | null; color: string | null };
type Store = { id: string; name: string };

type ProductRow = {
  store_id: string | null;
  category_id: string | null;
  gender: string | null;
  age_group: string | null;
  price_tier_id: string | null;
  stock: number | null;
  cost_price: number | null;
  price: number | null;
};

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

export function InventoryHealthDashboard() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [genderFilter, setGenderFilter] = useState<string>("all");
  const [ageFilter, setAgeFilter] = useState<string>("all");

  const loadMeta = useCallback(async () => {
    const [cats, tr, st] = await Promise.all([
      supabase.from("product_categories").select("id, name, slug").order("name"),
      supabase.from("price_tiers").select("id, label, min_price, max_price, color").order("min_price", { nullsFirst: true }),
      supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name"),
    ]);
    setCategories((cats.data as any) || []);
    setTiers((tr.data as any) || []);
    setStores((st.data as any) || []);
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    const pageSize = 1000;
    let from = 0;
    const all: ProductRow[] = [];
    while (true) {
      const { data, error } = await supabase
        .from("pos_products")
        .select("store_id, category_id, gender, age_group, price_tier_id, stock, cost_price, price")
        .range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) break;
      all.push(...(data as any));
      if (data.length < pageSize) break;
      from += pageSize;
    }
    setProducts(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMeta();
    loadProducts();
  }, [loadMeta, loadProducts]);

  // Filtered base
  const filtered = useMemo(() => {
    return products.filter(p => {
      if (storeFilter !== "all" && p.store_id !== storeFilter) return false;
      if (genderFilter !== "all" && (p.gender || "") !== genderFilter) return false;
      if (ageFilter !== "all" && (p.age_group || "") !== ageFilter) return false;
      return true;
    });
  }, [products, storeFilter, genderFilter, ageFilter]);

  // KPIs
  const kpis = useMemo(() => {
    let pairs = 0, cost = 0, sale = 0, skus = 0, uncategorized = 0;
    for (const p of filtered) {
      skus++;
      if (!p.category_id) uncategorized++;
      const s = toNumber(p.stock);
      if (s > 0) {
        pairs += s;
        cost += s * toNumber(p.cost_price);
        sale += s * toNumber(p.price);
      }
    }
    return { pairs, cost, sale, skus, uncategorized };
  }, [filtered]);

  // Matrix: rows = category × gender, cols = price tier
  type CellKey = string; // `${categoryId}|${gender}|${tierId}`
  const matrix = useMemo(() => {
    const map = new Map<CellKey, { pairs: number; skus: number; cost: number; sale: number }>();
    for (const p of filtered) {
      const cat = p.category_id || "uncat";
      const gen = p.gender || "—";
      const tier = p.price_tier_id || "untier";
      const key = `${cat}|${gen}|${tier}`;
      const cur = map.get(key) || { pairs: 0, skus: 0, cost: 0, sale: 0 };
      cur.skus += 1;
      const s = toNumber(p.stock);
      if (s > 0) {
        cur.pairs += s;
        cur.cost += s * toNumber(p.cost_price);
        cur.sale += s * toNumber(p.price);
      }
      map.set(key, cur);
    }
    return map;
  }, [filtered]);

  // Rows = combos found (category × gender) ordered
  const rows = useMemo(() => {
    const set = new Set<string>();
    for (const k of matrix.keys()) {
      const [cat, gen] = k.split("|");
      set.add(`${cat}|${gen}`);
    }
    const arr = Array.from(set).map(k => {
      const [catId, gen] = k.split("|");
      const cat = categories.find(c => c.id === catId);
      return { catId, gen, catName: cat?.name || "Sem categoria" };
    });
    arr.sort((a, b) => a.catName.localeCompare(b.catName) || a.gen.localeCompare(b.gen));
    return arr;
  }, [matrix, categories]);

  // Max pairs for heatmap shading
  const maxPairs = useMemo(() => {
    let m = 0;
    for (const v of matrix.values()) if (v.pairs > m) m = v.pairs;
    return m || 1;
  }, [matrix]);

  // Per-category totals
  const categoryTotals = useMemo(() => {
    const map = new Map<string, { name: string; pairs: number; skus: number; sale: number }>();
    for (const p of filtered) {
      const id = p.category_id || "uncat";
      const name = categories.find(c => c.id === id)?.name || "Sem categoria";
      const cur = map.get(id) || { name, pairs: 0, skus: 0, sale: 0 };
      cur.skus += 1;
      const s = toNumber(p.stock);
      if (s > 0) {
        cur.pairs += s;
        cur.sale += s * toNumber(p.price);
      }
      map.set(id, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.pairs - a.pairs);
  }, [filtered, categories]);

  const heatBg = (pairs: number) => {
    if (pairs === 0) return "bg-muted/20";
    const intensity = Math.min(1, pairs / maxPairs);
    // tailwind doesn't accept dynamic alpha; use inline style
    return "";
  };
  const heatStyle = (pairs: number): React.CSSProperties => {
    if (pairs === 0) return {};
    const intensity = Math.min(1, pairs / maxPairs);
    return { backgroundColor: `hsl(var(--primary) / ${0.08 + intensity * 0.45})` };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" /> Saúde do Estoque
          </h2>
          <p className="text-sm text-muted-foreground">
            Cruzamento de Categoria × Gênero × Faixa de Preço pra avaliar profundidade e cobertura do estoque.
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
          <Select value={ageFilter} onValueChange={setAgeFilter}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Faixa etária" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas idades</SelectItem>
              <SelectItem value="adulto">Adulto</SelectItem>
              <SelectItem value="infantil">Infantil</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={loadProducts} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} /> Atualizar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="grade">Cobertura de Grade</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
      {/* Score de 6 pilares + previsão */}
      <InventoryHealthScoreCard storeId={storeFilter === "all" ? null : storeFilter} />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="SKUs no recorte" value={fmtNum(kpis.skus)} icon={<Package className="h-5 w-5" />} loading={loading} />
        <KpiCard label="Pares em estoque" value={fmtNum(kpis.pairs)} icon={<Boxes className="h-5 w-5" />} loading={loading} />
        <KpiCard label="Valor de venda" value={fmtMoney(kpis.sale)} icon={<DollarSign className="h-5 w-5" />} loading={loading} />
        <KpiCard
          label="Sem categoria"
          value={fmtNum(kpis.uncategorized)}
          icon={<AlertTriangle className="h-5 w-5" />}
          loading={loading}
          tone={kpis.uncategorized > 0 ? "warn" : "ok"}
        />
      </div>

      {/* Matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Matriz Categoria × Gênero × Faixa de Preço</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando produtos...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Categoria</TableHead>
                    <TableHead>Gênero</TableHead>
                    {tiers.map(t => (
                      <TableHead key={t.id} className="text-center whitespace-nowrap">
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                          style={{ backgroundColor: t.color || "hsl(var(--primary))" }}
                        />
                        {t.label}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => {
                    let rowTotal = 0;
                    return (
                      <TableRow key={`${r.catId}|${r.gen}`}>
                        <TableCell className="font-medium">{r.catName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{r.gen}</Badge>
                        </TableCell>
                        {tiers.map(t => {
                          const cell = matrix.get(`${r.catId}|${r.gen}|${t.id}`);
                          const pairs = cell?.pairs || 0;
                          rowTotal += pairs;
                          return (
                            <TableCell
                              key={t.id}
                              className="text-center text-sm"
                              style={heatStyle(pairs)}
                            >
                              {pairs > 0 ? (
                                <div className="flex flex-col items-center">
                                  <span className="font-semibold">{fmtNum(pairs)}</span>
                                  <span className="text-[10px] text-muted-foreground">{fmtNum(cell?.skus || 0)} SKUs</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right font-bold">{fmtNum(rowTotal)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-category ranking */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ranking por categoria</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">SKUs</TableHead>
                <TableHead className="text-right">Pares</TableHead>
                <TableHead className="text-right">Valor de venda</TableHead>
                <TableHead className="text-right">% do estoque</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoryTotals.map(c => (
                <TableRow key={c.name}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-right">{fmtNum(c.skus)}</TableCell>
                  <TableCell className="text-right">{fmtNum(c.pairs)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(c.sale)}</TableCell>
                  <TableCell className="text-right">
                    {kpis.pairs > 0 ? `${fixed((c.pairs / kpis.pairs) * 100, 1)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="grade">
          <InventoryGradeCoverage />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({
  label, value, icon, loading, tone,
}: {
  label: string; value: string; icon: React.ReactNode; loading?: boolean;
  tone?: "ok" | "warn";
}) {
  return (
    <Card className={cn(tone === "warn" && "border-amber-500/40")}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className={cn("text-muted-foreground", tone === "warn" && "text-amber-500")}>{icon}</span>
        </div>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}
