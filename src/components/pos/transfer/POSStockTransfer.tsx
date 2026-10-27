import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Camera, Check, Copy, History, Loader2, Minus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { POSBarcodeScanner } from "../POSBarcodeScanner";
import {
  REAL_STORES, draftKey, destKey, transferLabel, linesTotals, buildReceiptText,
  type TransferLine, type TransferResult,
} from "./transferUtils";

interface Props { storeId: string }

interface ResolvedProduct {
  id: string; name: string; sku: string; barcode: string; size: string | null; color: string | null;
  image_url: string | null; stock: number; dest_stock: number | null;
}

const invoke = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("pos-stock-transfer-v2", { body });
  if (error && !data) throw new Error(error.message);
  return data;
};

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
  } catch { /* sem áudio */ }
}

export default function POSStockTransfer({ storeId }: Props) {
  const [tab, setTab] = useState<"new" | "history">("new");
  const [fromStore, setFromStore] = useState<string>(() => (REAL_STORES.some((s) => s.id === storeId) ? storeId : REAL_STORES[0].id));
  const [toStore, setToStore] = useState<string>("");
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<ResolvedProduct[] | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receipt, setReceipt] = useState<TransferResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastScan = useRef({ q: "", t: 0 });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storeName = (id: string) => REAL_STORES.find((s) => s.id === id)?.name || "—";
  const refocus = useCallback(() => setTimeout(() => inputRef.current?.focus(), 50), []);

  useEffect(() => {
    if (REAL_STORES.some((s) => s.id === storeId)) setFromStore(storeId);
  }, [storeId]);

  // Destino lembrado por loja de origem + rascunho da lista
  useEffect(() => {
    const saved = localStorage.getItem(destKey(fromStore));
    setToStore(saved && saved !== fromStore ? saved : REAL_STORES.find((s) => s.id !== fromStore)!.id);
    try { setLines(JSON.parse(localStorage.getItem(draftKey(fromStore)) || "[]")); } catch { setLines([]); }
    setReceipt(null);
  }, [fromStore]);

  useEffect(() => { if (toStore) localStorage.setItem(destKey(fromStore), toStore); }, [toStore, fromStore]);
  useEffect(() => { localStorage.setItem(draftKey(fromStore), JSON.stringify(lines)); }, [lines, fromStore]);

  // Saldos do destino mudam quando troca o destino: zera para recarregar no próximo bipe
  const [destLoadedFor, setDestLoadedFor] = useState(toStore);
  useEffect(() => {
    if (!toStore || toStore === destLoadedFor || lines.length === 0) { setDestLoadedFor(toStore); return; }
    setDestLoadedFor(toStore);
    (async () => {
      const updated = await Promise.all(lines.map(async (l) => {
        const res = await invoke({ action: "resolve", store_id: fromStore, to_store_id: toStore, code: l.barcode || l.sku }).catch(() => null);
        const p = res?.products?.find((x: ResolvedProduct) => x.id === l.pos_product_id);
        return p ? { ...l, origin_stock: Number(p.stock), dest_stock: Number(p.dest_stock ?? 0) } : l;
      }));
      setLines(updated);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toStore]);

  const addProduct = (p: ResolvedProduct) => {
    if (Number(p.stock) <= 0) { beep(false); toast.error(`Sem saldo na ${storeName(fromStore)}`); return; }
    setLines((prev) => {
      const ex = prev.find((l) => l.pos_product_id === p.id);
      if (ex) return prev.map((l) => (l.pos_product_id === p.id ? { ...l, quantity: l.quantity + 1, origin_stock: Number(p.stock), dest_stock: Number(p.dest_stock ?? 0) } : l));
      return [{ pos_product_id: p.id, name: p.name, size: p.size, color: p.color, sku: p.sku, barcode: p.barcode, image_url: p.image_url,
        quantity: 1, origin_stock: Number(p.stock), dest_stock: Number(p.dest_stock ?? 0) }, ...prev];
    });
    beep(true);
    toast.success(`Bipado: ${p.name}${p.size ? ` · ${p.size}` : ""}`, { duration: 1500 });
  };

  const handleScan = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q || !toStore) return;
    const now = Date.now();
    if (lastScan.current.q === q && now - lastScan.current.t < 1200) return;
    lastScan.current = { q, t: now };
    setCode(""); setBusy(true);
    try {
      const res = await invoke({ action: "resolve", store_id: fromStore, to_store_id: toStore, code: q });
      if (!res?.ok) throw new Error(res?.error || "Falha na busca");
      const products: ResolvedProduct[] = res.products || [];
      if (!products.length) { beep(false); toast.error(`Produto não encontrado no estoque da ${storeName(fromStore)}`); return; }
      if (products.length === 1 || res.mode === "code") addProduct(products[0]);
      else setChoices(products);
    } catch (e: any) {
      beep(false); toast.error(e.message);
    } finally { setBusy(false); refocus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromStore, toStore]);

  // Bipador digita rápido: dispara sozinho para códigos numéricos
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (/^\d{8,14}$/.test(code.trim())) debounceRef.current = setTimeout(() => handleScan(code), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [code, handleScan]);

  const changeQty = (id: string, delta: number) =>
    setLines((prev) => prev.map((l) => (l.pos_product_id === id ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)));
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.pos_product_id !== id));

  const { count, pairs, hasError } = useMemo(() => linesTotals(lines), [lines]);

  if (receipt) {
    return <Receipt result={receipt} storeName={storeName} onNew={() => { setReceipt(null); refocus(); }} />;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button variant={tab === "new" ? "default" : "outline"} className={tab === "new" ? "bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" : "border-pos-border text-pos-white"} onClick={() => setTab("new")}>Nova transferência</Button>
        <Button variant={tab === "history" ? "default" : "outline"} className={tab === "history" ? "bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2" : "border-pos-border text-pos-white gap-2"} onClick={() => setTab("history")}><History className="h-4 w-4" /> Histórico</Button>
      </div>

      {tab === "history" ? <TransferHistory storeId={fromStore} storeName={storeName} /> : (
        <>
          <div className="p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1">
                <p className="text-xs font-bold uppercase text-pos-white/60 mb-1">Origem</p>
                <Select value={fromStore} onValueChange={setFromStore}>
                  <SelectTrigger className="h-12 text-base font-bold" aria-label="Loja de origem"><SelectValue /></SelectTrigger>
                  <SelectContent>{REAL_STORES.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ArrowRight className="h-8 w-8 text-pos-orange self-center shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-bold uppercase text-pos-white/60 mb-1">Destino</p>
                <Select value={toStore} onValueChange={setToStore}>
                  <SelectTrigger className="h-12 text-base font-bold" aria-label="Loja de destino"><SelectValue /></SelectTrigger>
                  <SelectContent>{REAL_STORES.filter((s) => s.id !== fromStore).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                ref={inputRef} autoFocus value={code} disabled={!toStore}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScan(code); } }}
                placeholder="Bipe o código de barras"
                aria-label="Bipe o código de barras"
                className="h-14 text-lg font-bold"
              />
              <Button type="button" variant="outline" className="h-14 w-14 border-pos-border" onClick={() => setShowCamera(true)} aria-label="Usar câmera"><Camera className="h-6 w-6" /></Button>
              {busy && <Loader2 className="h-6 w-6 animate-spin text-pos-orange self-center" />}
            </div>
          </div>

          <div className="flex-1 overflow-auto px-4 space-y-2 pb-4">
            {lines.length === 0 && <p className="text-center text-pos-white/50 py-10">Bipe os produtos que vão sair da {storeName(fromStore)}.</p>}
            {lines.map((l) => {
              const over = l.quantity > l.origin_stock;
              return (
                <div key={l.pos_product_id} data-testid="transfer-line" className={`flex items-center gap-3 rounded-lg border p-3 ${over ? "border-destructive bg-destructive/10" : "border-pos-border bg-pos-card"}`}>
                  {l.image_url ? <img src={l.image_url} alt="" className="h-14 w-14 rounded object-cover" /> : <div className="h-14 w-14 rounded bg-pos-elevated" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-pos-white truncate">{l.name}</p>
                    <p className="text-xs text-pos-white/60">Tam {l.size || "-"} · {l.color || "-"} · {l.barcode || l.sku}</p>
                    <p className={`text-xs ${over ? "text-destructive font-bold" : "text-pos-white/80"}`}>Saldo {storeName(fromStore)}: {l.origin_stock} → ficará {l.origin_stock - l.quantity}</p>
                    <p className="text-xs text-pos-white/80">Saldo {storeName(toStore)}: {l.dest_stock} → ficará {l.dest_stock + l.quantity}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => { changeQty(l.pos_product_id, -1); refocus(); }} aria-label="Diminuir"><Minus className="h-4 w-4" /></Button>
                    <span className="w-10 text-center text-lg font-black text-pos-white">{l.quantity}</span>
                    <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => { changeQty(l.pos_product_id, 1); refocus(); }} aria-label="Aumentar"><Plus className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-10 w-10 text-destructive" onClick={() => { removeLine(l.pos_product_id); refocus(); }} aria-label="Remover"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-pos-border bg-pos-card p-4 flex items-center gap-3">
            <p className="flex-1 text-pos-white font-bold">{count} itens · {pairs} pares</p>
            <Button variant="outline" className="h-12" disabled={!lines.length} onClick={() => { setLines([]); refocus(); }}>Limpar</Button>
            <Button className="h-14 px-6 text-base font-black bg-pos-orange text-pos-black hover:bg-pos-orange-muted" disabled={!lines.length || hasError || !toStore} onClick={() => setConfirmOpen(true)}>
              CONFIRMAR TRANSFERÊNCIA
            </Button>
          </div>
        </>
      )}

      {showCamera && <POSBarcodeScanner onScan={(c) => { setShowCamera(false); handleScan(c); }} onClose={() => { setShowCamera(false); refocus(); }} />}

      <Dialog open={!!choices} onOpenChange={(o) => { if (!o) { setChoices(null); refocus(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Escolha o produto</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-auto space-y-1">
            {choices?.map((p) => (
              <button key={p.id} className="w-full text-left rounded border p-2 hover:bg-muted" onClick={() => { addProduct(p); setChoices(null); refocus(); }}>
                <p className="font-bold">{p.name}</p>
                <p className="text-xs text-muted-foreground">Tam {p.size || "-"} · {p.color || "-"} · {p.barcode || p.sku} · saldo {p.stock}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {confirmOpen && (
        <ConfirmDialog
          from={fromStore} to={toStore} lines={lines} storeName={storeName}
          onClose={() => { setConfirmOpen(false); refocus(); }}
          onDone={(r) => { setConfirmOpen(false); setLines([]); localStorage.removeItem(draftKey(fromStore)); setReceipt(r); }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({ from, to, lines, storeName, onClose, onDone }: {
  from: string; to: string; lines: TransferLine[]; storeName: (id: string) => string;
  onClose: () => void; onDone: (r: TransferResult) => void;
}) {
  const [notes, setNotes] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const [checking, setChecking] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const items = useMemo(() => lines.map((l) => ({ pos_product_id: l.pos_product_id, quantity: l.quantity })), [lines]);
  const { pairs } = linesTotals(lines);

  useEffect(() => {
    invoke({ action: "preview", from_store_id: from, to_store_id: to, items })
      .then((r) => setErrors(r?.ok ? [] : (r?.errors?.length ? r.errors : [r?.error || "Falha na conferência"])))
      .catch((e) => setErrors([e.message]))
      .finally(() => setChecking(false));
  }, [from, to, items]);

  const execute = async () => {
    setSending(true);
    try {
      const r = await invoke({ action: "execute", from_store_id: from, to_store_id: to, items, notes, idempotency_key: key });
      if (!r?.ok) throw new Error(r?.error || "Falha ao transferir");
      toast.success(`Transferência ${r.label} concluída`);
      onDone(r);
    } catch (e: any) {
      setErrors([e.message]);
    } finally { setSending(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !sending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-xl font-black">Confirmar transferência</DialogTitle></DialogHeader>
        <p className="text-lg font-bold flex items-center gap-2">{storeName(from)} <ArrowRight className="h-5 w-5" /> {storeName(to)}</p>
        <div className="max-h-60 overflow-auto space-y-1 text-sm">
          {lines.map((l) => <p key={l.pos_product_id}>{l.quantity}× {l.name} · tam {l.size || "-"}</p>)}
        </div>
        <p className="font-bold">{lines.length} itens · {pairs} pares</p>
        <Textarea placeholder="Observação (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        {checking && <p className="text-sm flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Conferindo saldos...</p>}
        {errors.length > 0 && (
          <div className="rounded border border-destructive bg-destructive/10 p-2 text-sm text-destructive space-y-1">
            {errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={sending}>Voltar</Button>
          <Button className="h-12 font-black bg-pos-orange text-pos-black hover:bg-pos-orange-muted" disabled={checking || sending || errors.length > 0} onClick={execute}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />} Transferir agora
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TransferTable({ t, storeName }: { t: TransferResult; storeName: (id: string) => string }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground">
          <th className="p-1">Produto</th><th className="p-1">Qtd</th>
          <th className="p-1">{storeName(t.from_store_id)}</th><th className="p-1">{storeName(t.to_store_id)}</th>
        </tr></thead>
        <tbody>
          {t.items.map((i) => (
            <tr key={i.pos_product_id_origem} className="border-t">
              <td className="p-1">{i.name} · tam {i.size || "-"}<br /><span className="text-xs text-muted-foreground">{i.barcode || i.sku}</span></td>
              <td className="p-1 font-bold">{i.quantity}</td>
              <td className="p-1">{i.origem_antes} → {i.origem_depois}</td>
              <td className="p-1">{i.destino_antes} → {i.destino_depois}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Receipt({ result, storeName, onNew }: { result: TransferResult; storeName: (id: string) => string; onNew: () => void }) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-2xl mx-auto rounded-xl bg-card text-card-foreground p-5 space-y-3">
        <p className="text-sm text-muted-foreground">Transferência concluída</p>
        <p className="text-3xl font-black">{transferLabel(result.numero)}</p>
        <p className="text-sm">{new Date(result.created_at).toLocaleString("pt-BR")} · {result.created_by_name}</p>
        <p className="text-lg font-bold flex items-center gap-2">{storeName(result.from_store_id)} <ArrowRight className="h-5 w-5" /> {storeName(result.to_store_id)}</p>
        <TransferTable t={result} storeName={storeName} />
        <div className="flex gap-2 pt-2">
          <Button className="h-12 font-black bg-pos-orange text-pos-black hover:bg-pos-orange-muted" onClick={onNew}>Nova transferência</Button>
          <Button variant="outline" className="h-12 gap-2" onClick={() => { navigator.clipboard.writeText(buildReceiptText(result, storeName)); toast.success("Resumo copiado"); }}><Copy className="h-4 w-4" /> Copiar resumo</Button>
        </div>
      </div>
    </div>
  );
}

const PAGE = 20;

function TransferHistory({ storeId, storeName }: { storeId: string; storeName: (id: string) => string }) {
  const [rows, setRows] = useState<(TransferResult & { status: string; reversed_of: string | null; reversed_by_transfer: string | null; notes: string | null; reverse_reason: string | null })[]>([]);
  const [total, setTotal] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ from: "", to: "", other: "all", user: "", search: "" });
  const [applied, setApplied] = useState(filters);
  const [detail, setDetail] = useState<(typeof rows)[number] | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await invoke({
        action: "history", store_id: storeId, limit: PAGE, offset: page * PAGE,
        other_store_id: applied.other !== "all" ? applied.other : undefined,
        from: applied.from ? `${applied.from}T00:00:00-03:00` : undefined,
        to: applied.to ? `${applied.to}T23:59:59-03:00` : undefined,
        user: applied.user || undefined, search: applied.search || undefined,
      });
      if (!r?.ok) throw new Error(r?.error || "Falha ao carregar");
      setRows(r.transfers.map((t: any) => ({ ...t, label: transferLabel(t.numero) })));
      setTotal(r.total); setIsAdmin(r.is_admin);
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }, [storeId, page, applied]);

  useEffect(() => { load(); }, [load]);

  const reverse = async () => {
    if (!detail) return;
    setReversing(true);
    try {
      const r = await invoke({ action: "reverse", transfer_id: detail.id, reason: reverseReason });
      if (!r?.ok) throw new Error(r?.error || "Falha ao estornar");
      toast.success(`Estornada: criada ${r.label}`);
      setDetail(null); setReverseReason(""); load();
    } catch (e: any) { toast.error(e.message, { duration: 10000 }); } finally { setReversing(false); }
  };

  const openById = (id: string) => { const t = rows.find((x) => x.id === id); if (t) setDetail(t); else { setApplied({ ...applied, search: "" }); toast.info("Transferência inversa fora desta página"); } };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} aria-label="De" />
        <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} aria-label="Até" />
        <Select value={filters.other} onValueChange={(v) => setFilters({ ...filters, other: v })}>
          <SelectTrigger aria-label="Outra loja"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as lojas</SelectItem>
            {REAL_STORES.filter((s) => s.id !== storeId).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Usuário" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} />
        <Input placeholder="Nº, nome ou código" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); setApplied(filters); } }} />
        <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={() => { setPage(0); setApplied(filters); }}>Filtrar</Button>
      </div>
      {loading && <Loader2 className="h-5 w-5 animate-spin text-pos-orange" />}
      {!loading && rows.length === 0 && <p className="text-pos-white/50 text-center py-8">Nenhuma transferência envolvendo a {storeName(storeId)}.</p>}
      {rows.map((t) => (
        <button key={t.id} onClick={() => setDetail(t)} className="w-full text-left rounded-lg border border-pos-border bg-pos-card p-3 hover:bg-pos-elevated">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-pos-white">{t.label}</span>
            {t.status === "estornada" && <Badge variant="destructive">Estornada</Badge>}
            {t.reversed_of && <Badge variant="secondary">Estorno</Badge>}
            <span className="text-sm text-pos-white/80">{storeName(t.from_store_id)} → {storeName(t.to_store_id)}</span>
            <span className="ml-auto text-xs text-pos-white/60">{new Date(t.created_at).toLocaleString("pt-BR")} · {t.created_by_name} · {t.total_items} pares</span>
          </div>
        </button>
      ))}
      {total > PAGE && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span className="text-pos-white text-sm">Página {page + 1} de {Math.ceil(total / PAGE)}</span>
          <Button variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Próxima</Button>
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) { setDetail(null); setReverseReason(""); } }}>
        <DialogContent className="max-w-2xl">
          {detail && (
            <>
              <DialogHeader><DialogTitle className="text-2xl font-black">{detail.label}</DialogTitle></DialogHeader>
              <p className="text-sm">{new Date(detail.created_at).toLocaleString("pt-BR")} · {detail.created_by_name}</p>
              <p className="font-bold">{storeName(detail.from_store_id)} → {storeName(detail.to_store_id)}</p>
              {detail.notes && <p className="text-sm text-muted-foreground">Obs.: {detail.notes}</p>}
              {detail.status === "estornada" && (
                <p className="text-sm text-destructive">Estornada{detail.reverse_reason ? `: ${detail.reverse_reason}` : ""}.{" "}
                  {detail.reversed_by_transfer && <button className="underline" onClick={() => openById(detail.reversed_by_transfer!)}>Ver transferência inversa</button>}
                </p>
              )}
              {detail.reversed_of && <button className="text-sm underline text-left" onClick={() => openById(detail.reversed_of!)}>Estorno da transferência original</button>}
              <TransferTable t={detail} storeName={storeName} />
              {isAdmin && detail.status === "concluida" && !detail.reversed_of && (
                <div className="space-y-2 border-t pt-3">
                  <Textarea placeholder="Motivo do estorno" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} maxLength={500} />
                  <Button variant="destructive" className="gap-2" disabled={!reverseReason.trim() || reversing} onClick={reverse}>
                    {reversing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Estornar
                  </Button>
                </div>
              )}
              <div className="flex justify-end"><Button variant="outline" onClick={() => setDetail(null)}><X className="h-4 w-4 mr-1" /> Fechar</Button></div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
