import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Minus, Plus, Share2, Download, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTeamIdentity } from "@/hooks/chat/useTeamIdentity";
import { parseLabelQuantity, isExpiredLabelCount, type StockLabelMode } from "@/lib/labels/stockLabelBatch";
import {
  STOCK_LABEL_STORES, applyStockLabelBatch, fetchVariantCodes, loadStockLabelPreview, type StockLabelStorePreview,
} from "@/lib/labels/stockLabelApi";
import { buildLabelPdf, expandLabels } from "@/lib/labels/labelPdf";
import { confirmRows, mobileLabelItems, stepQty } from "./labelCount";

interface V { id: string; color: string | null; size: string | null; code: string | null; name: string; price: number | null }

const MODES: { id: StockLabelMode; title: string; hint: string }[] = [
  { id: "print_only", title: "Só imprimir", hint: "Gera as etiquetas e não mexe no estoque." },
  { id: "balance", title: "Balanço", hint: "O saldo da loja passa a ser a quantidade de etiquetas." },
  { id: "add", title: "Adicionar", hint: "Soma as etiquetas ao saldo atual da loja." },
];

export function MobileLabelCount({ shell: Shell }: { shell: React.ComponentType<{ title: string; back?: boolean; children: React.ReactNode }> }) {
  const { masterId = "" } = useParams();
  const { senderName } = useTeamIdentity();
  const [name, setName] = useState("");
  const [variants, setVariants] = useState<V[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [storeId, setStoreId] = useState("");
  const [mode, setMode] = useState<StockLabelMode>("print_only");
  const [preview, setPreview] = useState<{ openedAt: string; preview: Record<string, StockLabelStorePreview> } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState<{ url: string; file: File } | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const { data: m } = await supabase.from("products_master").select("name,sale_price").eq("id", masterId).maybeSingle();
      const { data: vs } = await supabase.from("product_variants").select("id,color,size").eq("master_id", masterId).eq("is_active", true).order("color").order("size");
      const codes = await fetchVariantCodes((vs || []).map((v: any) => v.id));
      if (off) return;
      setName((m as any)?.name || "");
      setVariants((vs || []).map((v: any) => ({ ...v, code: codes.get(v.id) || null, name: (m as any)?.name || "", price: (m as any)?.sale_price ?? null })));
    })();
    return () => { off = true; };
  }, [masterId]);

  useEffect(() => {
    setPreview(null);
    if (!storeId) return;
    let off = false;
    loadStockLabelPreview([masterId], storeId)
      .then((r) => { if (!off) { setPreview(r); setVariants((c) => c && c.map((v) => r.preview[v.id]?.code ? { ...v, code: r.preview[v.id].code } : v)); } })
      .catch((e) => toast.error("Erro ao ler saldo: " + e.message));
    return () => { off = true; };
  }, [storeId, masterId]);

  const groups = useMemo(() => {
    const g = new Map<string, V[]>();
    for (const v of variants || []) { const k = v.color || "Sem cor"; g.set(k, [...(g.get(k) || []), v]); }
    return [...g];
  }, [variants]);
  const numeric = useMemo(() => Object.fromEntries(Object.entries(qty).map(([k, v]) => [k, parseLabelQuantity(v) || 0])), [qty]);
  const total = Object.values(numeric).reduce((a, b) => a + b, 0);
  const ids = (variants || []).map((v) => v.id);
  const items = mobileLabelItems(ids, qty, mode);
  const rows = preview && mode !== "print_only"
    ? confirmRows((variants || []).map((v) => ({ id: v.id, label: [v.color, v.size].filter(Boolean).join(" · ") || "Única" })), qty, mode, preview.preview)
    : [];

  function makePdf() {
    const labels = expandLabels(variants || [], numeric, name, null);
    if (!labels.length) { toast.error("Nenhuma etiqueta com código para gerar."); return; }
    const blob = buildLabelPdf(labels);
    const file = new File([blob], `etiquetas-${name.replace(/[^\w-]+/g, "_").slice(0, 40) || "produto"}.pdf`, { type: "application/pdf" });
    if (pdf) URL.revokeObjectURL(pdf.url);
    setPdf({ url: URL.createObjectURL(blob), file });
  }

  async function save() {
    if (!total && mode === "print_only") { toast.error("Informe a quantidade de etiquetas."); return; }
    if (!items.length) { toast.error("Informe a quantidade de etiquetas."); return; }
    if (!storeId || !preview) { toast.error("Escolha a loja e aguarde o saldo."); return; }
    const missing = (variants || []).filter((v) => numeric[v.id] > 0 && !v.code);
    if (missing.length) { toast.error(`${missing.length} variação(ões) sem código.`); return; }
    setBusy(true);
    try {
      const r = await applyStockLabelBatch({ storeId, mode, items, openedAt: preview.openedAt, masterId, scope: "selected", userName: senderName || undefined });
      toast.success(mode === "print_only" ? `Impressão registrada no lote #${r.numero}.` : `Lote #${r.numero} aplicado: ${r.changed || 0} itens alterados.`);
      if (r.skipped?.length) toast.warning("Algumas variações foram ignoradas.", { description: r.skipped.map((s) => `${s.code}: ${s.reason}`).join("\n") });
      setConfirm(false);
      makePdf();
      if (mode !== "print_only") setPreview(await loadStockLabelPreview([masterId], storeId));
    } catch (e: any) {
      toast.error(e?.message || "Erro ao aplicar o lote.");
      if (isExpiredLabelCount(e?.message || "")) setPreview(await loadStockLabelPreview([masterId], storeId));
    } finally { setBusy(false); }
  }

  if (!variants) return <Shell title="Etiquetas" back><Loader2 className="mx-auto h-6 w-6 animate-spin" /></Shell>;
  const canShare = !!pdf && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [pdf.file] });

  return (
    <Shell title={`Etiquetas · ${name}`} back>
      <section className="space-y-2">
        <p className="text-sm font-semibold">Loja</p>
        <div className="grid grid-cols-2 gap-2">
          {STOCK_LABEL_STORES.map((s) => (
            <Button key={s.id} variant={storeId === s.id ? "default" : "outline"} className="h-12" onClick={() => setStoreId(s.id)}>{s.name}</Button>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <p className="text-sm font-semibold">O que fazer</p>
        {MODES.map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)} aria-pressed={mode === m.id}
            className={`w-full rounded-lg border p-3 text-left ${mode === m.id ? "border-primary bg-primary/10" : "bg-card"}`}>
            <span className="block font-medium">{m.title}</span>
            <span className="block text-xs text-muted-foreground">{m.hint}</span>
          </button>
        ))}
        {mode === "balance" && <p className="text-xs text-muted-foreground">Tamanho deixado em branco não muda. Digite 0 para zerar.</p>}
      </section>
      {groups.map(([color, vs]) => (
        <section key={color} className="rounded-lg border bg-card p-3">
          <p className="mb-2 font-semibold">{color}</p>
          <ul className="space-y-2">
            {vs.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {v.size || "Única"}
                  {preview && <span className="block text-xs text-muted-foreground">Saldo {preview.preview[v.id]?.stock ?? 0}</span>}
                </span>
                <Button variant="outline" size="icon" className="h-11 w-11" aria-label={`Menos ${v.size}`}
                  onClick={() => setQty((p) => ({ ...p, [v.id]: stepQty(p[v.id], -1) }))}><Minus className="h-4 w-4" /></Button>
                <Input inputMode="numeric" value={qty[v.id] ?? ""} aria-label={`Etiquetas ${color} ${v.size || ""}`}
                  onChange={(e) => /^\d*$/.test(e.target.value) && setQty((p) => ({ ...p, [v.id]: e.target.value }))}
                  className="h-11 w-16 text-center text-lg" />
                <Button variant="outline" size="icon" className="h-11 w-11" aria-label={`Mais ${v.size}`}
                  onClick={() => setQty((p) => ({ ...p, [v.id]: stepQty(p[v.id], 1) }))}><Plus className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="sticky bottom-0 space-y-2 border-t bg-background py-3">
        <p className="text-center text-sm">Total: <b>{total}</b> etiquetas</p>
        <Button className="h-14 w-full text-base" disabled={busy || (!!storeId && !preview)}
          onClick={() => (mode === "print_only" ? (storeId ? save() : makePdf()) : storeId && preview ? setConfirm(true) : toast.error("Escolha a loja."))}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === "print_only" ? "Gerar PDF" : "Revisar e gravar"}
        </Button>
        {pdf && (
          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="outline" className="h-12"><a href={pdf.url} download={pdf.file.name}><Download className="mr-2 h-4 w-4" />Baixar PDF</a></Button>
            {canShare
              ? <Button variant="outline" className="h-12" onClick={() => navigator.share({ files: [pdf.file], title: "Etiquetas" }).catch(() => {})}><Share2 className="mr-2 h-4 w-4" />Compartilhar</Button>
              : <Button asChild variant="outline" className="h-12"><a href={pdf.url} target="_blank" rel="noreferrer">Abrir PDF</a></Button>}
          </div>
        )}
      </div>
      {confirm && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-label="Confirmar gravação">
          <header className="flex h-14 items-center gap-2 border-b px-3">
            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Fechar" onClick={() => setConfirm(false)}><X className="h-5 w-5" /></Button>
            <h2 className="font-bold">{mode === "balance" ? "Confirmar balanço" : "Confirmar adição"}</h2>
          </header>
          <ul className="flex-1 space-y-2 overflow-y-auto p-4">
            {rows.map((r) => (
              <li key={r.id} className="flex justify-between rounded-lg border bg-card p-3">
                <span>{r.label}</span><span className="font-bold">{r.before} → {r.after}</span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 border-t p-4">
            <Button variant="outline" className="h-14" onClick={() => setConfirm(false)}>Voltar</Button>
            <Button className="h-14" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Gravar"}</Button>
          </div>
        </div>
      )}
    </Shell>
  );
}
