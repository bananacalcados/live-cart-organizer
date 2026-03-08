import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Package, AlertTriangle, Search, TrendingDown } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface SaleItem {
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  quantity: number;
  total_price: number;
  store_id: string;
  source: "pos" | "shopify";
}

interface StockItem {
  name: string;
  variant: string | null;
  sku: string | null;
  stock: number;
  price: number;
  cost_price: number;
  store_id: string;
}

interface Store {
  id: string;
  name: string;
}

interface AbcCurveAnalysisProps {
  saleItems: SaleItem[];
  stockItems: StockItem[];
  stores: Store[];
  fmt: (v: number) => string;
}

const ABC_COLORS = {
  A: "hsl(142, 71%, 45%)",
  B: "hsl(48, 95%, 50%)",
  C: "hsl(0, 84%, 60%)",
  "Sem Venda": "hsl(0, 0%, 50%)",
};

function getParentName(name: string): string {
  // Remove variant info like "34 / Verde" patterns, trailing size numbers, etc.
  return name
    .replace(/\s*[-–]\s*(Conforto|Estilo|Alívio|leveza|Conforto Diário).*$/i, "")
    .replace(/\s+\d{2,3}\s*\/\s*\w+$/i, "")
    .trim();
}

function classifyAbc(items: { name: string; revenue: number; qty: number }[]) {
  const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);
  if (totalRevenue === 0) return items.map(i => ({ ...i, class: "Sem Venda" as const, cumPercent: 0 }));

  const sorted = [...items].sort((a, b) => b.revenue - a.revenue);
  let cumulative = 0;
  return sorted.map(item => {
    cumulative += item.revenue;
    const cumPercent = (cumulative / totalRevenue) * 100;
    let cls: "A" | "B" | "C";
    if (cumPercent <= 80) cls = "A";
    else if (cumPercent <= 95) cls = "B";
    else cls = "C";
    return { ...item, class: cls, cumPercent };
  });
}

export function AbcCurveAnalysis({ saleItems, stockItems, stores, fmt }: AbcCurveAnalysisProps) {
  const [storeView, setStoreView] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"child" | "parent">("child");
  const [showUnsold, setShowUnsold] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const physicalStores = stores.filter(s => {
    const n = s.name.toLowerCase();
    return !n.includes("shopify") && !n.includes("site") && !n.includes("online") && !n.includes("ecommerce");
  });

  const storeOptions = [
    { id: "all", name: "Todas (Geral)" },
    ...physicalStores,
    { id: "shopify", name: "Shopify (Online)" },
  ];

  // Filter sale items by store
  const filteredSales = useMemo(() => {
    if (storeView === "all") return saleItems;
    if (storeView === "shopify") return saleItems.filter(i => i.source === "shopify");
    return saleItems.filter(i => i.store_id === storeView);
  }, [saleItems, storeView]);

  // Filter stock items by store
  const filteredStock = useMemo(() => {
    if (storeView === "all") return stockItems;
    if (storeView === "shopify") return []; // No local stock for shopify
    return stockItems.filter(i => i.store_id === storeView);
  }, [stockItems, storeView]);

  // Aggregate by child (variant) or parent
  const aggregated = useMemo(() => {
    const map = new Map<string, { name: string; displayName: string; qty: number; revenue: number; skus: Set<string> }>();

    filteredSales.forEach(item => {
      const key = viewMode === "parent"
        ? getParentName(item.product_name)
        : `${item.product_name}||${item.variant_name || ""}||${item.sku || ""}`;
      
      const displayName = viewMode === "parent"
        ? getParentName(item.product_name)
        : item.variant_name
          ? `${item.product_name} — ${item.variant_name}`
          : item.product_name;

      const cur = map.get(key) || { name: key, displayName, qty: 0, revenue: 0, skus: new Set<string>() };
      cur.qty += item.quantity;
      cur.revenue += item.total_price;
      if (item.sku) cur.skus.add(item.sku);
      map.set(key, cur);
    });

    return [...map.values()].map(v => ({
      name: v.displayName,
      qty: v.qty,
      revenue: v.revenue,
      skuCount: v.skus.size,
    }));
  }, [filteredSales, viewMode]);

  // Unsold products (in stock but 0 sales)
  const unsoldProducts = useMemo(() => {
    if (!showUnsold) return [];

    const soldSkus = new Set(filteredSales.map(i => i.sku).filter(Boolean));
    const soldNames = new Set(filteredSales.map(i =>
      viewMode === "parent" ? getParentName(i.product_name) : `${i.product_name}||${i.variant_name || ""}`
    ));

    const unsold = new Map<string, { name: string; stock: number; value: number; cost: number }>();

    filteredStock.forEach(item => {
      if (item.stock <= 0) return;

      // Check if sold by SKU or name
      const isSold = (item.sku && soldSkus.has(item.sku)) ||
        soldNames.has(viewMode === "parent" ? getParentName(item.name) : `${item.name}||${item.variant || ""}`);

      if (isSold) return;

      const key = viewMode === "parent" ? getParentName(item.name) : `${item.name}||${item.variant || ""}`;
      const displayName = viewMode === "parent"
        ? getParentName(item.name)
        : item.variant ? `${item.name} — ${item.variant}` : item.name;

      const cur = unsold.get(key) || { name: displayName, stock: 0, value: 0, cost: 0 };
      cur.stock += item.stock;
      cur.value += item.stock * item.price;
      cur.cost += item.stock * (item.cost_price || 0);
      unsold.set(key, cur);
    });

    return [...unsold.values()].sort((a, b) => b.value - a.value);
  }, [filteredStock, filteredSales, showUnsold, viewMode]);

  const classified = classifyAbc(aggregated);

  // Filter by search
  const searched = searchTerm
    ? classified.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : classified;

  const searchedUnsold = searchTerm
    ? unsoldProducts.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : unsoldProducts;

  // Summary stats
  const countA = classified.filter(i => i.class === "A").length;
  const countB = classified.filter(i => i.class === "B").length;
  const countC = classified.filter(i => i.class === "C").length;
  const revenueA = classified.filter(i => i.class === "A").reduce((s, i) => s + i.revenue, 0);
  const revenueB = classified.filter(i => i.class === "B").reduce((s, i) => s + i.revenue, 0);
  const revenueC = classified.filter(i => i.class === "C").reduce((s, i) => s + i.revenue, 0);
  const totalUnsoldValue = unsoldProducts.reduce((s, i) => s + i.value, 0);

  const pieData = [
    { name: `A (${countA})`, value: revenueA },
    { name: `B (${countB})`, value: revenueB },
    { name: `C (${countC})`, value: revenueC },
    ...(unsoldProducts.length > 0 ? [{ name: `Sem Venda (${unsoldProducts.length})`, value: totalUnsoldValue }] : []),
  ].filter(d => d.value > 0);

  const pieColors = [ABC_COLORS.A, ABC_COLORS.B, ABC_COLORS.C, ABC_COLORS["Sem Venda"]];

  const classBadge = (cls: string) => {
    switch (cls) {
      case "A": return <Badge className="bg-green-600 text-white text-[10px] px-1.5">A</Badge>;
      case "B": return <Badge className="bg-yellow-500 text-black text-[10px] px-1.5">B</Badge>;
      case "C": return <Badge className="bg-red-500 text-white text-[10px] px-1.5">C</Badge>;
      default: return <Badge variant="secondary" className="text-[10px] px-1.5">{cls}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={storeView} onValueChange={setStoreView}>
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <SelectValue placeholder="Filtrar por loja" />
          </SelectTrigger>
          <SelectContent>
            {storeOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 border rounded-md p-0.5">
          <button
            className={`px-3 py-1 text-xs rounded ${viewMode === "child" ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => setViewMode("child")}
          >
            Produto Filho
          </button>
          <button
            className={`px-3 py-1 text-xs rounded ${viewMode === "parent" ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => setViewMode("parent")}
          >
            Produto Pai
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Switch checked={showUnsold} onCheckedChange={setShowUnsold} id="show-unsold" />
          <Label htmlFor="show-unsold" className="text-xs">Mostrar sem venda</Label>
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar produto..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Badge className="bg-green-600 text-white">A</Badge>
            <div>
              <p className="text-sm font-bold">{countA} produtos</p>
              <p className="text-[10px] text-muted-foreground">{fmt(revenueA)} (80% receita)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Badge className="bg-yellow-500 text-black">B</Badge>
            <div>
              <p className="text-sm font-bold">{countB} produtos</p>
              <p className="text-[10px] text-muted-foreground">{fmt(revenueB)} (15% receita)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Badge className="bg-red-500 text-white">C</Badge>
            <div>
              <p className="text-sm font-bold">{countC} produtos</p>
              <p className="text-[10px] text-muted-foreground">{fmt(revenueC)} (5% receita)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-bold">{unsoldProducts.length} sem venda</p>
              <p className="text-[10px] text-muted-foreground">{fmt(totalUnsoldValue)} parado</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-bold">{aggregated.length + unsoldProducts.length} total</p>
              <p className="text-[10px] text-muted-foreground">{fmt(revenueA + revenueB + revenueC)} vendidos</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pie chart */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Distribuição ABC</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ABC Table */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Curva ABC — {viewMode === "parent" ? "Produto Pai" : "Produto Filho"}
              {storeView !== "all" && ` — ${storeOptions.find(s => s.id === storeView)?.name}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-8">#</TableHead>
                    <TableHead className="text-xs w-10">ABC</TableHead>
                    <TableHead className="text-xs">Produto</TableHead>
                    <TableHead className="text-xs text-right">Qtd</TableHead>
                    <TableHead className="text-xs text-right">Receita</TableHead>
                    <TableHead className="text-xs text-right">% Acum.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searched.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-bold text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>{classBadge(item.class)}</TableCell>
                      <TableCell className="text-xs max-w-[300px] truncate">{item.name}</TableCell>
                      <TableCell className="text-xs text-right">{item.qty}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{fmt(item.revenue)}</TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">{item.cumPercent.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Unsold products */}
      {showUnsold && searchedUnsold.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Produtos sem Venda no Período ({searchedUnsold.length})
              <Badge variant="destructive" className="text-[10px]">{fmt(totalUnsoldValue)} em estoque parado</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">#</TableHead>
                    <TableHead className="text-xs">Produto</TableHead>
                    <TableHead className="text-xs text-right">Estoque</TableHead>
                    <TableHead className="text-xs text-right">Valor (Venda)</TableHead>
                    <TableHead className="text-xs text-right">Custo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchedUnsold.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs max-w-[300px] truncate">{item.name}</TableCell>
                      <TableCell className="text-xs text-right">{item.stock}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{fmt(item.value)}</TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">{fmt(item.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
