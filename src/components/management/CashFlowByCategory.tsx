import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { ChevronRight, ChevronDown, ArrowDownRight, ArrowUpRight, Pencil, Trash2, ExternalLink } from "lucide-react";

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
  attachment_url: string | null;
  metadata: any;
}

interface Category { id: string; name: string; parent_id: string | null; type: "income" | "expense"; }
interface Store { id: string; name: string; }

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CashFlowByCategory({ stores }: { stores: Store[] }) {
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
  const [drilldownKey, setDrilldownKey] = useState<{ direction: "in" | "out"; categoryId: string | null; label: string } | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("cash_flow_entries").select("*")
      .gte("entry_date", from).lte("entry_date", to)
      .in("status", ["confirmed", "reconciled", "pending_category", "needs_review", "ai_suggested"])
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

  const catName = (id: string | null) => id ? (cats.find((c) => c.id === id)?.name || "—") : "Sem categoria";
  const catParent = (id: string | null) => {
    if (!id) return null;
    const c = cats.find((x) => x.id === id);
    return c?.parent_id || null;
  };
  const rootCatOf = (id: string | null): { id: string | null; name: string } => {
    if (!id) return { id: null, name: "Sem categoria" };
    let cur = cats.find((c) => c.id === id);
    while (cur?.parent_id) cur = cats.find((c) => c.id === cur!.parent_id);
    return { id: cur?.id || null, name: cur?.name || "Sem categoria" };
  };

  const grouped = useMemo(() => {
    // Group by ROOT category for each direction; inside root, sub-aggregate by leaf category
    const make = (dir: "in" | "out") => {
      const filtered = entries.filter((e) => e.direction === dir);
      const byRoot = new Map<string, { id: string | null; name: string; total: number; subs: Map<string, { id: string | null; name: string; total: number; count: number }> }>();
      for (const e of filtered) {
        const root = rootCatOf(e.category_id);
        const rk = root.id || "__none__";
        const r = byRoot.get(rk) || { id: root.id, name: root.name, total: 0, subs: new Map() };
        r.total += Number(e.amount);
        const sk = e.category_id || "__none__";
        const s = r.subs.get(sk) || { id: e.category_id, name: catName(e.category_id), total: 0, count: 0 };
        s.total += Number(e.amount);
        s.count += 1;
        r.subs.set(sk, s);
        byRoot.set(rk, r);
      }
      return [...byRoot.values()].sort((a, b) => b.total - a.total);
    };
    return { in: make("in"), out: make("out") };
  }, [entries, cats]);

  const totals = useMemo(() => {
    const inc = entries.filter((e) => e.direction === "in").reduce((s, e) => s + Number(e.amount), 0);
    const out = entries.filter((e) => e.direction === "out").reduce((s, e) => s + Number(e.amount), 0);
    return { inc, out, net: inc - out };
  }, [entries]);

  const toggle = (k: string) => {
    const n = new Set(expanded);
    n.has(k) ? n.delete(k) : n.add(k);
    setExpanded(n);
  };

  const drilldownEntries = useMemo(() => {
    if (!drilldownKey) return [];
    return entries.filter((e) =>
      e.direction === drilldownKey.direction &&
      (drilldownKey.categoryId === null ? !e.category_id : e.category_id === drilldownKey.categoryId)
    ).sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [entries, drilldownKey]);

  const saveEdit = async () => {
    if (!editing) return;
    const { error } = await supabase.from("cash_flow_entries").update({
      description: editing.description,
      amount: editing.amount,
      entry_date: editing.entry_date,
      category_id: editing.category_id,
      payment_method: editing.payment_method,
      store_id: editing.store_id,
      status: editing.category_id ? "confirmed" : editing.status,
    }).eq("id", editing.id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Salvo" });
    setEditing(null);
    load();
  };

  const delEntry = async (id: string) => {
    if (!confirm("Excluir este lançamento?")) return;
    await supabase.from("cash_flow_entries").delete().eq("id", id);
    setEditing(null);
    load();
  };

  const openAttachment = async (path: string) => {
    const { data } = await supabase.storage.from("financial-receipts").createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const renderSection = (dir: "in" | "out") => {
    const data = dir === "in" ? grouped.in : grouped.out;
    const color = dir === "in" ? "text-emerald-600" : "text-destructive";
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`text-sm ${color}`}>{dir === "in" ? "Entradas por Categoria" : "Saídas por Categoria"}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.length === 0 && <div className="text-sm text-muted-foreground">Nenhum lançamento.</div>}
          <div className="space-y-1">
            {data.map((root) => {
              const k = `${dir}:${root.id || "_"}`;
              const open = expanded.has(k);
              const subs = [...root.subs.values()].sort((a, b) => b.total - a.total);
              return (
                <div key={k}>
                  <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => toggle(k)}>
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="flex-1 text-sm font-medium">{root.name}</span>
                    <span className={`text-sm font-semibold ${color}`}>{fmt(root.total)}</span>
                  </div>
                  {open && subs.map((s) => (
                    <div key={`${k}:${s.id || "_"}`}
                      className="flex items-center gap-2 py-1 px-2 ml-6 text-sm rounded hover:bg-muted cursor-pointer"
                      onClick={() => setDrilldownKey({ direction: dir, categoryId: s.id, label: s.name })}>
                      <span className="flex-1 text-muted-foreground">{s.name}</span>
                      <Badge variant="outline" className="text-[10px]">{s.count}</Badge>
                      <span className={color}>{fmt(s.total)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  };

  const storeName = (id: string | null) => stores.find((s) => s.id === id)?.name || "—";

  return (
    <div className="space-y-4">
      {/* Filters + totals */}
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
          <div className="flex-1" />
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Entradas</div>
            <div className="text-lg font-bold text-emerald-600">{fmt(totals.inc)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Saídas</div>
            <div className="text-lg font-bold text-destructive">{fmt(totals.out)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Saldo</div>
            <div className={`text-lg font-bold ${totals.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(totals.net)}</div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-6 text-muted-foreground text-sm">Carregando…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderSection("in")}
          {renderSection("out")}
        </div>
      )}

      {/* Drill-down sheet */}
      <Sheet open={!!drilldownKey} onOpenChange={(o) => !o && setDrilldownKey(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {drilldownKey?.direction === "in" ? "Entradas" : "Saídas"} — {drilldownKey?.label}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {drilldownEntries.length === 0 && <div className="text-sm text-muted-foreground">Nenhum lançamento.</div>}
            {drilldownEntries.map((e) => (
              <div key={e.id} className="border rounded-lg p-3 space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium flex items-center gap-2">
                    {e.direction === "in" ? <ArrowUpRight className="h-4 w-4 text-emerald-600" /> : <ArrowDownRight className="h-4 w-4 text-destructive" />}
                    <span className={e.direction === "in" ? "text-emerald-600" : "text-destructive"}>{fmt(Number(e.amount))}</span>
                    <span className="text-xs text-muted-foreground">{new Date(e.entry_date).toLocaleDateString("pt-BR")}</span>
                  </div>
                  <div className="flex gap-1">
                    {e.attachment_url && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openAttachment(e.attachment_url!)} title="Ver anexo">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(e)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => delEntry(e.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-foreground">
                  📝 {e.description || <span className="text-muted-foreground italic">sem observação</span>}
                </div>
                <div className="flex gap-2 flex-wrap text-[11px] text-muted-foreground">
                  {e.payment_method && <Badge variant="outline" className="text-[10px]">{e.payment_method}</Badge>}
                  <Badge variant="outline" className="text-[10px]">{storeName(e.store_id)}</Badge>
                  <Badge variant="outline" className="text-[10px]">{e.source}</Badge>
                  {(e.status === "pending_category" || e.status === "needs_review" || e.status === "ai_suggested") && <Badge variant="secondary" className="text-[10px]">revisar categoria</Badge>}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit dialog */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader><SheetTitle>Editar lançamento</SheetTitle></SheetHeader>
          {editing && (
            <div className="mt-4 space-y-3">
              <div><label className="text-xs text-muted-foreground">Data</label>
                <Input type="date" value={editing.entry_date} onChange={(e) => setEditing({ ...editing, entry_date: e.target.value })} /></div>
              <div><label className="text-xs text-muted-foreground">Valor (R$)</label>
                <Input type="number" step="0.01" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })} /></div>
              <div><label className="text-xs text-muted-foreground">Descrição / observação</label>
                <Input value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div><label className="text-xs text-muted-foreground">Categoria</label>
                <Select value={editing.category_id || "__none__"} onValueChange={(v) => setEditing({ ...editing, category_id: v === "__none__" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem categoria</SelectItem>
                    {cats.filter((c) => c.type === (editing.direction === "in" ? "income" : "expense"))
                      .map((c) => <SelectItem key={c.id} value={c.id}>{c.parent_id ? `  → ${c.name}` : c.name}</SelectItem>)}
                  </SelectContent>
                </Select></div>
              <div><label className="text-xs text-muted-foreground">Loja</label>
                <Select value={editing.store_id || "__none__"} onValueChange={(v) => setEditing({ ...editing, store_id: v === "__none__" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select></div>
              <div><label className="text-xs text-muted-foreground">Método</label>
                <Input value={editing.payment_method || ""} onChange={(e) => setEditing({ ...editing, payment_method: e.target.value })} /></div>
              <div className="flex gap-2 pt-2">
                <Button onClick={saveEdit}>Salvar</Button>
                <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
