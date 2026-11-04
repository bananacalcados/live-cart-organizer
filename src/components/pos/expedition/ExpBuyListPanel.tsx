import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Settings2, CheckCircle2, Undo2, Trash2, PackagePlus, Search } from "lucide-react";
import { GradeSize, formatGradeSizes, pairsPerGrade, parseGradeSizes, totalPairs } from "@/lib/purchaseGrades";

const db = supabase as any;
const PAGE = 50;

interface GradeType { id: string; name: string; sizes: GradeSize[]; is_active: boolean }
interface Product { code: string; master_id: string; product_name: string; color: string | null; brand: string | null; sale_price: number | null; total_stock: number | null }
interface Item {
  id: string; request_id: string; product_code: string | null; product_name: string; color: string | null; brand: string | null;
  grade_name: string; grade_sizes: GradeSize[]; grades_qty: number; status: "pendente" | "comprado";
  confirmed_at: string | null; confirmed_by_name: string | null; expected_arrival: string | null; notes: string | null; created_at: string;
  purchase_requests?: { created_at: string; created_by_name: string | null };
}

async function userName() {
  const { data } = await supabase.auth.getUser();
  return (data?.user?.user_metadata as any)?.full_name || data?.user?.email || null;
}
const fmtDT = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtD = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

/* ---------------- Grades ---------------- */
function GradeManager({ open, onOpenChange, grades, reload }: { open: boolean; onOpenChange: (o: boolean) => void; grades: GradeType[]; reload: () => void }) {
  const [editing, setEditing] = useState<GradeType | null>(null);
  const [name, setName] = useState("");
  const [sizesText, setSizesText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = parseGradeSizes(sizesText);

  const startEdit = (g: GradeType | null) => {
    setEditing(g);
    setName(g?.name || "");
    setSizesText(g ? formatGradeSizes(g.sizes) : "");
  };
  const save = async () => {
    if (!name.trim() || parsed.length === 0) return toast.error("Informe nome e tamanhos");
    setBusy(true);
    const payload = { name: name.trim(), sizes: parsed, updated_at: new Date().toISOString() };
    const { error } = editing ? await db.from("purchase_grade_types").update(payload).eq("id", editing.id) : await db.from("purchase_grade_types").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Grade salva");
    startEdit(null);
    reload();
  };
  const toggle = async (g: GradeType) => {
    const { error } = await db.from("purchase_grade_types").update({ is_active: !g.is_active }).eq("id", g.id);
    if (error) return toast.error(error.message);
    reload();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Grades</DialogTitle></DialogHeader>
        <div className="space-y-2 border rounded-lg p-3">
          <Label>Nome da grade</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Feminina 34-39" />
          <Label>Tamanhos (tamanho:quantidade)</Label>
          <Input value={sizesText} onChange={(e) => setSizesText(e.target.value)} placeholder="34:1, 35:2, 36:3, 37:3, 38:2, 39:1" />
          <p className="text-xs text-muted-foreground">Sem quantidade conta 1 par. Esta grade: <b>{pairsPerGrade(parsed)} pares</b></p>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}{editing ? "Salvar alterações" : "Criar grade"}</Button>
            {editing && <Button size="sm" variant="outline" onClick={() => startEdit(null)}>Cancelar</Button>}
          </div>
        </div>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {grades.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma grade criada.</p>}
          {grades.map((g) => (
            <div key={g.id} className={`flex items-center justify-between border rounded-lg p-2 ${g.is_active ? "" : "opacity-50"}`}>
              <div>
                <div className="font-bold">{g.name} <span className="text-xs font-normal text-muted-foreground">· {pairsPerGrade(g.sizes)} pares</span></div>
                <div className="text-xs text-muted-foreground">{formatGradeSizes(g.sizes)}</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => startEdit(g)}>Editar</Button>
                <Button size="sm" variant="ghost" onClick={() => toggle(g)}>{g.is_active ? "Desativar" : "Reativar"}</Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Adicionar ---------------- */
interface Pick { product: Product; gradeId: string; qty: number; notes: string }

function AddDialog({ open, onOpenChange, grades, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; grades: GradeType[]; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Product[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [saving, setSaving] = useState(false);
  const active = grades.filter((g) => g.is_active);

  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 350); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    let q = db.from("v_product_color_codes").select("code,master_id,product_name,color,brand,sale_price,total_stock");
    if (term) {
      const s = term.replace(/[%,()]/g, " ");
      q = q.or(`code.ilike.%${s}%,product_name.ilike.%${s}%,color.ilike.%${s}%,brand.ilike.%${s}%`);
    }
    const { data, error } = await q.order("code").range(p * PAGE, p * PAGE + PAGE);
    setLoading(false);
    if (error) return toast.error(error.message);
    const list = (data || []) as Product[];
    setHasMore(list.length > PAGE);
    const pageRows = list.slice(0, PAGE);
    setRows((prev) => (p === 0 ? pageRows : [...prev, ...pageRows]));
    setPage(p);
  }, [term]);

  useEffect(() => { if (open) load(0); }, [open, load]);
  useEffect(() => { if (!open) { setPicks({}); setSearch(""); } }, [open]);

  const togglePick = (p: Product) => setPicks((prev) => {
    const n = { ...prev };
    if (n[p.code]) delete n[p.code];
    else n[p.code] = { product: p, gradeId: active[0]?.id || "", qty: 1, notes: "" };
    return n;
  });
  const upd = (code: string, patch: Partial<Pick>) => setPicks((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
  const list = Object.values(picks);

  const confirm = async () => {
    if (list.length === 0) return;
    if (list.some((x) => !x.gradeId || x.qty < 1)) return toast.error("Escolha grade e quantidade de todos os produtos");
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const name = await userName();
      const { data: req, error } = await db.from("purchase_requests").insert({ created_by: auth?.user?.id, created_by_name: name }).select("id").single();
      if (error) throw error;
      const items = list.map((x) => {
        const g = grades.find((gg) => gg.id === x.gradeId)!;
        return {
          request_id: req.id, product_code: x.product.code, master_id: x.product.master_id, product_name: x.product.product_name,
          color: x.product.color, brand: x.product.brand, grade_type_id: g.id, grade_name: g.name, grade_sizes: g.sizes,
          pairs_per_grade: pairsPerGrade(g.sizes), grades_qty: Math.floor(x.qty), notes: x.notes.trim() || null,
        };
      });
      const { error: e2 } = await db.from("purchase_request_items").insert(items);
      if (e2) throw e2;
      toast.success(`${items.length} produto(s) adicionados à lista`);
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader><DialogTitle>Adicionar produtos à lista de compras</DialogTitle></DialogHeader>
        {active.length === 0 && <p className="text-sm text-destructive">Crie uma grade antes (botão "Grades").</p>}
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por código, nome, cor ou marca" />
        </div>
        <div className="grid md:grid-cols-2 gap-3 flex-1 min-h-0">
          <div className="border rounded-lg overflow-y-auto max-h-[55vh]">
            {rows.map((p) => (
              <label key={p.code} className="flex items-center gap-2 p-2 border-b cursor-pointer hover:bg-muted/50">
                <Checkbox checked={!!picks[p.code]} onCheckedChange={() => togglePick(p)} />
                <span className="font-black text-primary w-14">{p.code}</span>
                <span className="flex-1 text-sm">{p.product_name}{p.color ? ` · ${p.color}` : ""}<span className="block text-xs text-muted-foreground">{p.brand || ""} · estoque {p.total_stock ?? 0}</span></span>
              </label>
            ))}
            {loading && <div className="p-3 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>}
            {!loading && hasMore && <Button variant="ghost" className="w-full" onClick={() => load(page + 1)}>Carregar mais</Button>}
            {!loading && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhum produto.</p>}
          </div>
          <div className="border rounded-lg overflow-y-auto max-h-[55vh] p-2 space-y-2">
            <p className="text-sm font-bold">Selecionados ({list.length})</p>
            {list.map((x) => {
              const g = grades.find((gg) => gg.id === x.gradeId);
              return (
                <div key={x.product.code} className="border rounded-lg p-2 space-y-1">
                  <div className="text-sm"><b>{x.product.code}</b> {x.product.product_name}{x.product.color ? ` · ${x.product.color}` : ""}</div>
                  <div className="flex gap-2 items-center">
                    <select className="border rounded-md h-9 px-2 bg-background text-sm flex-1" value={x.gradeId} onChange={(e) => upd(x.product.code, { gradeId: e.target.value })}>
                      {active.map((gg) => <option key={gg.id} value={gg.id}>{gg.name} ({pairsPerGrade(gg.sizes)} pares)</option>)}
                    </select>
                    <Input type="number" min={1} className="w-20" value={x.qty} onChange={(e) => upd(x.product.code, { qty: Number(e.target.value) })} />
                    <span className="text-xs whitespace-nowrap">grades</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{g ? `${totalPairs(g.sizes, x.qty)} pares no total` : ""}</div>
                  <Input placeholder="Observação (opcional)" value={x.notes} onChange={(e) => upd(x.product.code, { notes: e.target.value })} />
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={confirm} disabled={saving || list.length === 0}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Confirmar {list.length} produto(s)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Painel ---------------- */
export function ExpBuyListPanel() {
  const [grades, setGrades] = useState<GradeType[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"pendente" | "comprado" | "todos">("pendente");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmItem, setConfirmItem] = useState<Item | null>(null);
  const [arrival, setArrival] = useState("");
  const [moreItem, setMoreItem] = useState<Item | null>(null);
  const [moreQty, setMoreQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const loadGrades = useCallback(async () => {
    const { data } = await db.from("purchase_grade_types").select("id,name,sizes,is_active").order("name");
    setGrades((data || []) as GradeType[]);
  }, []);

  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 350); return () => clearTimeout(t); }, [search]);

  const loadItems = useCallback(async (p: number) => {
    setLoading(true);
    let q = db.from("purchase_request_items").select("id,request_id,product_code,product_name,color,brand,grade_name,grade_sizes,grades_qty,status,confirmed_at,confirmed_by_name,expected_arrival,notes,created_at,purchase_requests(created_at,created_by_name)");
    if (filter !== "todos") q = q.eq("status", filter);
    if (term) { const s = term.replace(/[%,()]/g, " "); q = q.or(`product_code.ilike.%${s}%,product_name.ilike.%${s}%,color.ilike.%${s}%`); }
    const { data, error } = await q.order("created_at", { ascending: false }).range(p * PAGE, p * PAGE + PAGE);
    setLoading(false);
    if (error) return toast.error(error.message);
    const list = (data || []) as Item[];
    setHasMore(list.length > PAGE);
    setItems((prev) => (p === 0 ? list.slice(0, PAGE) : [...prev, ...list.slice(0, PAGE)]));
    setPage(p);
  }, [filter, term]);

  useEffect(() => { loadGrades(); }, [loadGrades]);
  useEffect(() => { loadItems(0); }, [loadItems]);

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    items.forEach((i) => { const a = m.get(i.request_id) || []; a.push(i); m.set(i.request_id, a); });
    return Array.from(m.entries());
  }, [items]);

  const doConfirm = async () => {
    if (!confirmItem) return;
    setBusy(true);
    const { error } = await db.rpc("purchase_item_set_status", { p_item_id: confirmItem.id, p_confirm: true, p_by: await userName(), p_arrival: arrival || null });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Pedido confirmado — vai chegar na loja");
    setConfirmItem(null); setArrival(""); loadItems(0);
  };
  const undo = async (i: Item) => {
    const { error } = await db.rpc("purchase_item_set_status", { p_item_id: i.id, p_confirm: false, p_by: await userName(), p_arrival: null });
    if (error) return toast.error(error.message);
    loadItems(0);
  };
  const doMore = async () => {
    if (!moreItem || moreQty < 1) return;
    setBusy(true);
    const { error } = await db.rpc("purchase_item_add_grades", { p_item_id: moreItem.id, p_add: Math.floor(moreQty), p_by: await userName() });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`+${moreQty} grade(s)`);
    setMoreItem(null); setMoreQty(1); loadItems(0);
  };
  const remove = async (i: Item) => {
    if (!window.confirm(`Remover ${i.product_name} da lista?`)) return;
    const { error } = await db.from("purchase_request_items").delete().eq("id", i.id);
    if (error) return toast.error(error.message);
    loadItems(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-black text-pos-text mr-auto">Lista de Compras</h2>
        <Button variant="outline" onClick={() => setGradeOpen(true)}><Settings2 className="h-4 w-4 mr-1" />Grades</Button>
        <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {(["pendente", "comprado", "todos"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "pendente" ? "Pendentes" : f === "comprado" ? "Comprados" : "Todos"}
          </Button>
        ))}
        <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código, nome ou cor" />
      </div>

      {groups.length === 0 && !loading && <p className="text-muted-foreground">Nada na lista.</p>}
      {groups.map(([reqId, list]) => (
        <div key={reqId} className="border rounded-xl bg-pos-elevated p-3 space-y-2">
          <div className="text-sm text-pos-muted-text">
            Solicitado em <b>{fmtDT(list[0].purchase_requests?.created_at || list[0].created_at)}</b>
            {list[0].purchase_requests?.created_by_name ? ` por ${list[0].purchase_requests.created_by_name}` : ""}
          </div>
          {list.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 border rounded-lg p-2 bg-background">
              <span className="font-black text-xl text-primary w-16">{i.product_code}</span>
              <div className="flex-1 min-w-[200px]">
                <div className="font-bold">{i.product_name}{i.color ? ` · ${i.color}` : ""}</div>
                <div className="text-xs text-muted-foreground">
                  {i.grade_name} ({formatGradeSizes(i.grade_sizes)}) · <b>{i.grades_qty} grade(s)</b> · {totalPairs(i.grade_sizes, i.grades_qty)} pares
                </div>
                {i.notes && <div className="text-xs italic">{i.notes}</div>}
                {i.status === "comprado" && (
                  <div className="text-xs text-green-700 dark:text-green-400">
                    Comprado em {fmtDT(i.confirmed_at!)}{i.confirmed_by_name ? ` por ${i.confirmed_by_name}` : ""}{i.expected_arrival ? ` · chega ${fmtD(i.expected_arrival)}` : ""}
                  </div>
                )}
              </div>
              <Badge variant={i.status === "comprado" ? "default" : "secondary"}>{i.status === "comprado" ? "Comprado — vai chegar" : "Pendente"}</Badge>
              <Button size="sm" variant="outline" onClick={() => { setMoreItem(i); setMoreQty(1); }}><PackagePlus className="h-4 w-4 mr-1" />+ Grades</Button>
              {i.status === "pendente" ? (
                <>
                  <Button size="sm" className="font-black" onClick={() => { setConfirmItem(i); setArrival(""); }}><CheckCircle2 className="h-4 w-4 mr-1" />CONFIRMAR PEDIDO</Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => undo(i)}><Undo2 className="h-4 w-4 mr-1" />Desfazer</Button>
              )}
            </div>
          ))}
        </div>
      ))}
      {loading && <div className="text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>}
      {!loading && hasMore && <Button variant="outline" className="w-full" onClick={() => loadItems(page + 1)}>Carregar mais</Button>}

      <GradeManager open={gradeOpen} onOpenChange={setGradeOpen} grades={grades} reload={loadGrades} />
      {addOpen && <AddDialog open={addOpen} onOpenChange={setAddOpen} grades={grades} onDone={() => loadItems(0)} />}

      <Dialog open={!!confirmItem} onOpenChange={(o) => !o && setConfirmItem(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Confirmar compra</DialogTitle></DialogHeader>
          <p className="text-sm">{confirmItem?.product_code} · {confirmItem?.product_name} — {confirmItem?.grades_qty} grade(s)</p>
          <Label>Previsão de chegada (opcional)</Label>
          <Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} />
          <DialogFooter><Button onClick={doConfirm} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Confirmar pedido</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!moreItem} onOpenChange={(o) => !o && setMoreItem(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Aumentar grades</DialogTitle></DialogHeader>
          <p className="text-sm">{moreItem?.product_code} · {moreItem?.product_name} — hoje {moreItem?.grades_qty} grade(s)</p>
          <Label>Quantas grades a mais?</Label>
          <Input type="number" min={1} value={moreQty} onChange={(e) => setMoreQty(Number(e.target.value))} />
          <DialogFooter><Button onClick={doMore} disabled={busy || moreQty < 1}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Adicionar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
