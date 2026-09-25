import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, Pencil, Search, PackagePlus } from "lucide-react";
import { toast } from "sonner";

type SizeQty = { size: string; qty: number };
interface Template { id: string; name: string; sizes: SizeQty[] }
interface Store { id: string; name: string }
interface PosRow { id: string; parent_sku: string | null; name: string | null; size: string | null; color: string | null; stock: number | null; store_id: string }

const sizeSort = (a: string, b: string) => {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b);
};
const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

interface Props { open: boolean; onOpenChange: (v: boolean) => void; onApplied?: () => void }

export function GradeStockEntryDialog({ open, onOpenChange, onApplied }: Props) {
  const [tab, setTab] = useState("entry");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [stores, setStores] = useState<Store[]>([]);

  const loadTemplates = async () => {
    const { data, error } = await (supabase as any).from("stock_grade_templates").select("*").order("name");
    if (error) return toast.error(error.message);
    setTemplates((data || []) as Template[]);
  };

  useEffect(() => {
    if (!open) return;
    loadTemplates();
    supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name")
      .then(({ data }) => setStores((data || []) as Store[]));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackagePlus className="h-5 w-5" /> Entrada por grade</DialogTitle>
          <DialogDescription>Reponha de uma vez a grade completa de um produto já cadastrado.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="entry">Lançar entrada</TabsTrigger>
            <TabsTrigger value="templates">Grades padrão ({templates.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="entry">
            <EntryTab templates={templates} stores={stores} onGoTemplates={() => setTab("templates")} onApplied={onApplied} />
          </TabsContent>
          <TabsContent value="templates">
            <TemplatesTab templates={templates} reload={loadTemplates} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesTab({ templates, reload }: { templates: Template[]; reload: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<SizeQty[]>([]);
  const [defaultQty, setDefaultQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [stdSizes, setStdSizes] = useState<string[]>([]);

  useEffect(() => {
    (supabase as any).from("product_sizes").select("label, numeric_value").order("numeric_value", { ascending: true, nullsFirst: false })
      .then(({ data }: any) => setStdSizes(((data || []) as { label: string }[]).map((s) => s.label)));
  }, []);

  const reset = () => { setEditingId(null); setName(""); setRows([]); setDefaultQty(1); };

  const save = async () => {
    const clean = rows.filter((r) => r.size.trim() && r.qty > 0).map((r) => ({ size: r.size.trim(), qty: Math.floor(r.qty) }));
    if (!name.trim()) return toast.error("Dê um nome à grade");
    if (!clean.length) return toast.error("Selecione ao menos um tamanho");
    clean.sort((a, b) => sizeSort(a.size, b.size));
    setSaving(true);
    const q = (supabase as any).from("stock_grade_templates");
    const { error } = editingId
      ? await q.update({ name: name.trim(), sizes: clean }).eq("id", editingId)
      : await q.insert({ name: name.trim(), sizes: clean });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Grade salva");
    reset();
    reload();
  };

  const remove = async (t: Template) => {
    if (!confirm(`Apagar a grade "${t.name}"?`)) return;
    const { error } = await (supabase as any).from("stock_grade_templates").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    reload();
  };

  const toggleSize = (s: string) => {
    setRows((p) => {
      if (p.some((r) => r.size === s)) return p.filter((r) => r.size !== s);
      return [...p, { size: s, qty: defaultQty }].sort((a, b) => sizeSort(a.size, b.size));
    });
  };
  const allSizes = useMemo(() => {
    const set = new Set([...stdSizes, ...rows.map((r) => r.size)]);
    return [...set].sort(sizeSort);
  }, [stdSizes, rows]);
  const total = rows.reduce((s, r) => s + (r.size.trim() ? Number(r.qty) || 0 : 0), 0);

  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-lg border p-3 space-y-3">
        <div className="space-y-1">
          <Label>Nome da grade</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Grade A feminina 34-39" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label>Tamanhos (clique para marcar quantos quiser)</Label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Qtd. ao marcar:</span>
              <Input type="number" min={1} className="h-7 w-14" value={defaultQty}
                onChange={(e) => setDefaultQty(Math.max(1, parseInt(e.target.value) || 1))} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allSizes.map((s) => {
              const sel = rows.some((r) => r.size === s);
              return (
                <button key={s} type="button" onClick={() => toggleSize(s)}
                  className={`h-8 min-w-10 px-2 rounded-md border text-sm font-medium transition-colors ${sel ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}>
                  {s}
                </button>
              );
            })}
            {allSizes.length === 0 && <p className="text-sm text-muted-foreground">Nenhum tamanho padrão cadastrado no sistema.</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setRows(allSizes.map((s) => ({ size: s, qty: rows.find((r) => r.size === s)?.qty ?? defaultQty })))}>Marcar todos</Button>
            <Button size="sm" variant="outline" onClick={() => setRows([])}>Limpar</Button>
          </div>
        </div>
        {rows.length > 0 && (
          <div className="space-y-1">
            <Label>Quantidade de cada tamanho</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {rows.map((r, i) => (
                <div key={r.size} className="flex gap-1 items-center rounded-md border px-2 py-1">
                  <span className="text-sm font-medium flex-1">{r.size}</span>
                  <span className="text-xs text-muted-foreground">×</span>
                  <Input className="h-7 w-14" type="number" min={1} value={r.qty}
                    onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">{total} pares por grade</span>
          <div className="ml-auto flex gap-2">
            {editingId && <Button size="sm" variant="ghost" onClick={reset}>Cancelar</Button>}
            <Button size="sm" onClick={save} disabled={saving}>{saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}{editingId ? "Salvar alterações" : "Criar grade"}</Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {templates.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhuma grade cadastrada ainda.</p>}
        {templates.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-md border p-2">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{t.name} <span className="text-xs text-muted-foreground">· {t.sizes.reduce((s, x) => s + x.qty, 0)} pares</span></div>
              <div className="flex flex-wrap gap-1 mt-1">
                {t.sizes.map((s) => <Badge key={s.size} variant="secondary" className="text-[10px]">{s.size} × {s.qty}</Badge>)}
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => { setEditingId(t.id); setName(t.name); setRows(t.sizes.map((s) => ({ ...s }))); }}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => remove(t)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

      <div className="space-y-2">
        {templates.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhuma grade cadastrada ainda.</p>}
        {templates.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-md border p-2">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{t.name} <span className="text-xs text-muted-foreground">· {t.sizes.reduce((s, x) => s + x.qty, 0)} pares</span></div>
              <div className="flex flex-wrap gap-1 mt-1">
                {t.sizes.map((s) => <Badge key={s.size} variant="secondary" className="text-[10px]">{s.size} × {s.qty}</Badge>)}
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => { setEditingId(t.id); setName(t.name); setRows(t.sizes.map((s) => ({ ...s }))); }}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => remove(t)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntryTab({ templates, stores, onGoTemplates, onApplied }: { templates: Template[]; stores: Store[]; onGoTemplates: () => void; onApplied?: () => void }) {
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ parent_sku: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [parent, setParent] = useState<{ parent_sku: string; name: string } | null>(null);
  const [variants, setVariants] = useState<PosRow[]>([]);
  const [color, setColor] = useState("");
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => { if (!storeId && stores.length) setStoreId(stores[0].id); }, [stores, storeId]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2 || !storeId) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const safe = term.replace(/[,()%]/g, " ");
      const { data } = await supabase.from("pos_products").select("parent_sku, name")
        .eq("store_id", storeId).not("parent_sku", "is", null)
        .or(`name.ilike.%${safe}%,parent_sku.ilike.%${safe}%,sku.ilike.%${safe}%,barcode.eq.${safe}`)
        .limit(300);
      const map = new Map<string, string>();
      for (const r of (data || []) as any[]) if (!map.has(r.parent_sku)) map.set(r.parent_sku, String(r.name || "").replace(/\s*-\s*[^-]*$/, ""));
      setResults([...map.entries()].slice(0, 20).map(([parent_sku, name]) => ({ parent_sku, name })));
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [search, storeId]);

  const loadVariants = async (p: { parent_sku: string; name: string }) => {
    setParent(p); setResults([]); setSearch(""); setColor("");
    const { data } = await supabase.from("pos_products").select("id, parent_sku, name, size, color, stock, store_id")
      .eq("store_id", storeId).eq("parent_sku", p.parent_sku).limit(500);
    const rows = (data || []) as PosRow[];
    setVariants(rows);
    const colors = [...new Set(rows.map((r) => r.color || ""))];
    if (colors.length === 1) setColor(colors[0]);
  };

  useEffect(() => { setParent(null); setVariants([]); }, [storeId]);

  const colors = useMemo(() => [...new Set(variants.map((v) => v.color || ""))].sort(), [variants]);
  const colorVariants = useMemo(() => variants.filter((v) => (v.color || "") === color), [variants, color]);

  // Quantidade total por tamanho somando as grades escolhidas
  const plan = useMemo(() => {
    const bySize = new Map<string, number>();
    for (const t of templates) {
      const n = picks[t.id] || 0;
      if (!n) continue;
      for (const s of t.sizes) bySize.set(s.size, (bySize.get(s.size) || 0) + s.qty * n);
    }
    return [...bySize.entries()].sort((a, b) => sizeSort(a[0], b[0])).map(([size, qty]) => {
      const v = colorVariants.find((x) => norm(x.size) === norm(size));
      return { size, qty, variant: v || null };
    });
  }, [picks, templates, colorVariants]);

  const missing = plan.filter((p) => !p.variant);
  const totalPairs = plan.reduce((s, p) => s + (p.variant ? p.qty : 0), 0);

  const apply = async () => {
    if (!parent || !plan.length) return;
    if (colors.length > 1 && !colors.includes(color)) return toast.error("Escolha a cor");
    const gradeLabel = templates.filter((t) => picks[t.id]).map((t) => `${t.name} ${picks[t.id]}x`).join(" + ");
    setApplying(true);
    let ok = 0; const errors: string[] = [];
    for (const p of plan) {
      if (!p.variant) continue;
      const { data, error } = await supabase.functions.invoke("pos-stock-movement", {
        body: { product_id: p.variant.id, movement_type: "entrada", quantity: p.qty, reason: `Entrada por grade (${gradeLabel})${reason ? " — " + reason : ""}` },
      });
      if (error || !data?.success) errors.push(`${p.size}: ${data?.error || error?.message}`);
      else { ok++; setVariants((prev) => prev.map((v) => (v.id === p.variant!.id ? { ...v, stock: data.new_stock } : v))); }
    }
    setApplying(false);
    if (errors.length) toast.error(`Falhou em ${errors.length} tamanho(s): ${errors[0]}`, { duration: 10000 });
    if (ok) {
      toast.success(`Entrada lançada: ${totalPairs} pares em ${ok} tamanho(s)`);
      setPicks({}); setReason("");
      onApplied?.();
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Loja que recebeu</Label>
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger><SelectValue placeholder="Loja" /></SelectTrigger>
            <SelectContent>{stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1 relative">
          <Label>Produto</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, código ou código de barras" />
            {searching && <Loader2 className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 animate-spin" />}
          </div>
          {results.length > 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-y-auto">
              {results.map((r) => (
                <button key={r.parent_sku} className="w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => loadVariants(r)}>
                  {r.name} <span className="text-xs text-muted-foreground font-mono">{r.parent_sku}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {parent && (
        <div className="rounded-lg border p-3 space-y-3">
          <div className="font-medium">{parent.name} <span className="text-xs font-mono text-muted-foreground">{parent.parent_sku}</span></div>
          <div className="space-y-1">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-1">
              {colors.map((c) => (
                <Button key={c || "_"} size="sm" variant={color === c ? "default" : "outline"} onClick={() => setColor(c)}>{c || "Sem cor"}</Button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Grades que chegaram</Label>
              <Button size="sm" variant="link" className="h-auto p-0" onClick={onGoTemplates}>Gerenciar grades</Button>
            </div>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Cadastre uma grade padrão primeiro.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {templates.map((t) => (
                  <div key={t.id} className={`flex items-center gap-2 rounded-md border p-2 ${picks[t.id] ? "border-primary bg-primary/5" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{t.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{t.sizes.map((s) => `${s.size}×${s.qty}`).join(" ")}</div>
                    </div>
                    <Input type="number" min={0} className="h-8 w-16" value={picks[t.id] || ""} placeholder="0"
                      onChange={(e) => setPicks((p) => ({ ...p, [t.id]: Math.max(0, parseInt(e.target.value) || 0) }))} />
                    <span className="text-xs text-muted-foreground">x</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {plan.length > 0 && (colors.length <= 1 || color !== undefined) && (
            <div className="space-y-2">
              <Label>Resumo da entrada {color && `· ${color}`}</Label>
              <div className="flex flex-wrap gap-2">
                {plan.map((p) => (
                  <div key={p.size} className={`rounded-md border px-2 py-1 text-center ${p.variant ? "" : "border-destructive text-destructive"}`}>
                    <div className="text-xs font-bold">{p.size}</div>
                    <div className="text-sm">+{p.qty}</div>
                    {p.variant && <div className="text-[10px] text-muted-foreground">{p.variant.stock ?? 0} → {(p.variant.stock ?? 0) + p.qty}</div>}
                  </div>
                ))}
              </div>
              {missing.length > 0 && (
                <p className="text-xs text-destructive">
                  Tamanho(s) {missing.map((m) => m.size).join(", ")} não existem nesta cor/loja e serão ignorados. Cadastre a variação antes, se precisar.
                </p>
              )}
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Observação (opcional, ex.: nota 1234)" />
              <Button className="w-full" onClick={apply} disabled={applying || totalPairs === 0}>
                {applying && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Lançar entrada de {totalPairs} pares
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
