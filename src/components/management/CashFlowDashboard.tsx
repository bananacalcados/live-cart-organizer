import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownRight, ArrowUpRight, TrendingUp, TrendingDown, Wallet } from "lucide-react";

interface Entry {
  id: string;
  entry_date: string;
  direction: "in" | "out";
  amount: number;
  payment_method: string | null;
  description: string | null;
  source: string;
  status: string;
  store_id: string | null;
  category_id: string | null;
}

interface Store { id: string; name: string; }

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CashFlowDashboard({ stores }: { stores: Store[] }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [storeFilter, setStoreFilter] = useState("all");
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    let q = supabase.from("cash_flow_entries").select("*")
      .gte("entry_date", from).lte("entry_date", to)
      .order("entry_date", { ascending: false }).limit(1000);
    if (storeFilter !== "all") q = q.eq("store_id", storeFilter);
    const { data } = await q;
    setEntries((data as Entry[]) || []);
    const { data: cats } = await supabase.from("financial_categories").select("id,name");
    setCategoryNames(Object.fromEntries((cats || []).map((c: any) => [c.id, c.name])));
    setLoading(false);
  };

  useEffect(() => { load(); }, [from, to, storeFilter]);

  const totals = useMemo(() => {
    const inc = entries.filter(e => e.direction === "in").reduce((s, e) => s + Number(e.amount), 0);
    const out = entries.filter(e => e.direction === "out").reduce((s, e) => s + Number(e.amount), 0);
    return { inc, out, net: inc - out };
  }, [entries]);

  const storeName = (id: string | null) => stores.find(s => s.id === id)?.name || "—";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="pt-6 flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Entradas</p><p className="text-2xl font-bold text-emerald-600">{fmt(totals.inc)}</p></div>
          <TrendingUp className="h-8 w-8 text-emerald-500/50" />
        </CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Saídas</p><p className="text-2xl font-bold text-destructive">{fmt(totals.out)}</p></div>
          <TrendingDown className="h-8 w-8 text-destructive/50" />
        </CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Saldo do período</p><p className={`text-2xl font-bold ${totals.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(totals.net)}</p></div>
          <Wallet className="h-8 w-8 text-muted-foreground/50" />
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lançamentos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap items-end">
            <div><label className="text-xs text-muted-foreground">De</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-40" /></div>
            <div><label className="text-xs text-muted-foreground">Até</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-40" /></div>
            <div><label className="text-xs text-muted-foreground">Loja</label>
              <Select value={storeFilter} onValueChange={setStoreFilter}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border max-h-[500px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Loja</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Carregando…</TableCell></TableRow>}
                {!loading && entries.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Nenhum lançamento no período.</TableCell></TableRow>}
                {entries.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(e.entry_date).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-xs">{storeName(e.store_id)}</TableCell>
                    <TableCell className="text-xs">{e.category_id ? categoryNames[e.category_id] || "—" : "—"}</TableCell>
                    <TableCell className="text-xs max-w-[300px] truncate">{e.description}</TableCell>
                    <TableCell className="text-xs">{e.payment_method}</TableCell>
                    <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{e.source}</Badge></TableCell>
                    <TableCell className={`text-right font-medium whitespace-nowrap ${e.direction === "in" ? "text-emerald-600" : "text-destructive"}`}>
                      {e.direction === "in" ? <ArrowUpRight className="inline h-3 w-3" /> : <ArrowDownRight className="inline h-3 w-3" />} {fmt(Number(e.amount))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
