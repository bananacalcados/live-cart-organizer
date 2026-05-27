import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Wallet } from "lucide-react";

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
  ledger: "faturamento" | "realidade";
}
interface Category { id: string; name: string; parent_id: string | null; type: "income" | "expense"; }
interface Store { id: string; name: string; }

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CashFlowDashboard({ stores }: { stores: Store[] }) {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [storeFilter, setStoreFilter] = useState("all");
  const [ledger, setLedger] = useState<"faturamento" | "realidade">("faturamento");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    let q = supabase.from("cash_flow_entries").select("*")
      .gte("entry_date", from).lte("entry_date", to)
      .in("status", ["confirmed", "reconciled", "pending_category"])
      .eq("ledger", ledger)
      .order("entry_date", { ascending: false }).limit(5000);
    if (storeFilter !== "all") q = q.eq("store_id", storeFilter);
    const { data } = await q;
    setEntries((data as Entry[]) || []);
    const { data: c } = await supabase.from("financial_categories").select("id,name,parent_id,type");
    setCats((c as Category[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [from, to, storeFilter, ledger]);

  const rootCatOf = (id: string | null): { id: string; name: string } => {
    if (!id) return { id: "__none__", name: "Sem categoria" };
    let cur = cats.find((c) => c.id === id);
    while (cur?.parent_id) cur = cats.find((c) => c.id === cur!.parent_id);
    return { id: cur?.id || "__none__", name: cur?.name || "Sem categoria" };
  };
  const catName = (id: string | null) => id ? (cats.find((c) => c.id === id)?.name || "—") : "Sem categoria";

  const groups = useMemo(() => {
    const build = (dir: "in" | "out") => {
      const filtered = entries.filter((e) => e.direction === dir);
      const m = new Map<string, { id: string; name: string; total: number; subs: Map<string, { id: string; name: string; total: number; count: number }> }>();
      for (const e of filtered) {
        const r = rootCatOf(e.category_id);
        const g = m.get(r.id) || { id: r.id, name: r.name, total: 0, subs: new Map() };
        g.total += Number(e.amount);
        const sk = e.category_id || "__none__";
        const s = g.subs.get(sk) || { id: sk, name: catName(e.category_id), total: 0, count: 0 };
        s.total += Number(e.amount); s.count += 1;
        g.subs.set(sk, s);
        m.set(r.id, g);
      }
      return [...m.values()].sort((a, b) => b.total - a.total);
    };
    return { in: build("in"), out: build("out") };
  }, [entries, cats]);

  const totalIn = useMemo(() => groups.in.reduce((s, g) => s + g.total, 0), [groups]);
  const totalOut = useMemo(() => groups.out.reduce((s, g) => s + g.total, 0), [groups]);
  const net = totalIn - totalOut;

  const toggle = (k: string) => {
    const n = new Set(expanded);
    n.has(k) ? n.delete(k) : n.add(k);
    setExpanded(n);
  };

  // Saldo acumulado: começa em totalIn, vai diminuindo a cada grupo de saída
  let running = totalIn;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-muted-foreground">De</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
          <div><label className="text-xs text-muted-foreground">Até</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
          <div><label className="text-xs text-muted-foreground">Loja</label>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block">Livro</label>
            <div className="inline-flex rounded-md border h-9 overflow-hidden">
              <button type="button" onClick={() => setLedger("faturamento")}
                className={`px-3 text-xs font-medium ${ledger === "faturamento" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                Faturamento
              </button>
              <button type="button" onClick={() => setLedger("realidade")}
                className={`px-3 text-xs font-medium border-l ${ledger === "realidade" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                Realidade
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="pt-6 flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Entradas</p><p className="text-2xl font-bold text-emerald-600">{fmt(totalIn)}</p></div>
          <TrendingUp className="h-8 w-8 text-emerald-500/50" />
        </CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Saídas</p><p className="text-2xl font-bold text-destructive">{fmt(totalOut)}</p></div>
          <TrendingDown className="h-8 w-8 text-destructive/50" />
        </CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Saldo do período</p><p className={`text-2xl font-bold ${net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(net)}</p></div>
          <Wallet className="h-8 w-8 text-muted-foreground/50" />
        </CardContent></Card>
      </div>

      {/* DRE */}
      <Card>
        <CardHeader><CardTitle className="text-base">Fluxo de Caixa — {ledger === "faturamento" ? "Faturamento" : "Realidade"}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Carregando…</div>
          ) : (
            <div className="space-y-1 text-sm">
              {/* ENTRADAS */}
              <div className="flex items-center gap-2 py-2 px-2 bg-emerald-500/10 rounded font-semibold text-emerald-700 dark:text-emerald-400 uppercase text-xs tracking-wide">
                Entradas
              </div>
              {groups.in.length === 0 && <div className="py-2 px-4 text-muted-foreground text-xs">Nenhuma entrada no período.</div>}
              {groups.in.map((g) => {
                const k = `in:${g.id}`;
                const open = expanded.has(k);
                const subs = [...g.subs.values()].sort((a, b) => b.total - a.total);
                return (
                  <div key={k}>
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => toggle(k)}>
                      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <span className="flex-1">{g.name}</span>
                      <span className="font-medium text-emerald-600">{fmt(g.total)}</span>
                    </div>
                    {open && subs.map((s) => (
                      <div key={`${k}:${s.id}`} className="flex items-center gap-2 py-1 px-2 ml-7 text-xs">
                        <span className="flex-1 text-muted-foreground">{s.name}</span>
                        <Badge variant="outline" className="text-[10px]">{s.count}</Badge>
                        <span className="text-emerald-600">{fmt(s.total)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="flex items-center gap-2 py-2 px-2 mt-1 border-t font-semibold text-emerald-700 dark:text-emerald-400">
                <span className="flex-1">TOTAL ENTRADAS</span>
                <span>{fmt(totalIn)}</span>
              </div>

              {/* SAÍDAS com saldo acumulado por categoria */}
              <div className="flex items-center gap-2 py-2 px-2 bg-destructive/10 rounded font-semibold text-destructive uppercase text-xs tracking-wide mt-3">
                Saídas
              </div>
              {groups.out.length === 0 && <div className="py-2 px-4 text-muted-foreground text-xs">Nenhuma saída no período.</div>}
              {groups.out.map((g) => {
                const k = `out:${g.id}`;
                const open = expanded.has(k);
                const subs = [...g.subs.values()].sort((a, b) => b.total - a.total);
                running -= g.total;
                const saldoAposGrupo = running;
                return (
                  <div key={k}>
                    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => toggle(k)}>
                      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <span className="flex-1">{g.name}</span>
                      <span className="font-medium text-destructive w-32 text-right">- {fmt(g.total)}</span>
                      <span className={`font-semibold w-32 text-right text-xs ${saldoAposGrupo >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                        = {fmt(saldoAposGrupo)}
                      </span>
                    </div>
                    {open && subs.map((s) => (
                      <div key={`${k}:${s.id}`} className="flex items-center gap-2 py-1 px-2 ml-7 text-xs">
                        <span className="flex-1 text-muted-foreground">{s.name}</span>
                        <Badge variant="outline" className="text-[10px]">{s.count}</Badge>
                        <span className="text-destructive w-32 text-right">- {fmt(s.total)}</span>
                        <span className="w-32" />
                      </div>
                    ))}
                  </div>
                );
              })}

              <div className={`flex items-center gap-2 py-2.5 px-2 mt-2 border-t-2 font-bold ${net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
                <span className="flex-1 uppercase text-sm">Saldo Final</span>
                <span className="text-base">{fmt(net)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
