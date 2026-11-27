import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Package, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { firstLegacyThumbnails } from "@/components/inventory/legacyProductSummary";
import { MobileProductFilters, categoryChipLabel, mergePage, rpcParams } from "./productFilters";

interface Row { id: string; name: string; sku_root: string; is_active: boolean; variant_count: number; color_count: number; size_count: number; total_stock: number; total_count: number }

const chip = (on: boolean) => `min-h-[44px] shrink-0 rounded-full border px-4 text-sm font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`;

export function FilterChips({ filters, onChange, catNames, onOpenCats }: {
  filters: MobileProductFilters; onChange: (f: MobileProductFilters) => void; catNames: Record<string, string>; onOpenCats: () => void;
}) {
  const any = filters.activeOnly || filters.inStock || filters.categoryIds.length > 0;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={chip(filters.activeOnly)} aria-pressed={filters.activeOnly} onClick={() => onChange({ ...filters, activeOnly: !filters.activeOnly })}>Ativos</button>
      <button type="button" className={chip(filters.inStock)} aria-pressed={filters.inStock} onClick={() => onChange({ ...filters, inStock: !filters.inStock })}>Com estoque</button>
      <button type="button" className={`${chip(filters.categoryIds.length > 0)} max-w-full truncate`} onClick={onOpenCats}>{categoryChipLabel(filters.categoryIds, catNames)}</button>
      {any && <button type="button" className="min-h-[44px] px-2 text-sm text-muted-foreground underline" onClick={() => onChange({ activeOnly: false, inStock: false, categoryIds: [] })}>Limpar filtros</button>}
    </div>
  );
}

export function CategorySheet({ cats, selected, onClose }: { cats: { id: string; name: string }[]; selected: string[]; onClose: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>(selected);
  const shown = useMemo(() => cats.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())), [cats, q]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-label="Categorias">
      <header className="flex h-14 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Fechar" onClick={() => onClose(selected)}><X className="h-5 w-5" /></Button>
        <h2 className="flex-1 font-bold">Categorias</h2>
        <Button variant="ghost" className="h-11" onClick={() => setSel([])}>Nenhuma</Button>
      </header>
      <div className="p-3"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar categoria" className="h-12 text-base" /></div>
      <ul className="flex-1 overflow-y-auto px-3">
        {shown.map((c) => {
          const on = sel.includes(c.id);
          return (
            <li key={c.id}>
              <button type="button" className="flex min-h-[52px] w-full items-center gap-3 border-b text-left"
                onClick={() => setSel(on ? sel.filter((x) => x !== c.id) : [...sel, c.id])}>
                <span className={`flex h-6 w-6 items-center justify-center rounded border ${on ? "bg-primary text-primary-foreground" : ""}`}>{on && <Check className="h-4 w-4" />}</span>
                <span className="flex-1 truncate">{c.name}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Nenhuma categoria.</li>}
      </ul>
      <div className="border-t p-3"><Button className="h-14 w-full text-base" onClick={() => onClose(sel)}>Aplicar{sel.length ? ` (${sel.length})` : ""}</Button></div>
    </div>
  );
}

export function ProductList({ filters, term, photosVisible }: { filters: MobileProductFilters; term: string; photosVisible: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const key = JSON.stringify([filters, term.trim()]);

  useEffect(() => { setRows([]); setTotal(0); setPage(0); setThumbs({}); }, [key]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError(false);
    (supabase.rpc as any)("mobile_masters_list", rpcParams(filters, term, page)).then(async ({ data, error }: any) => {
      if (cancelled) return;
      setBusy(false);
      if (error) { setError(true); return; }
      const list = (data || []) as Row[];
      setRows((prev) => (page === 0 ? list : mergePage(prev, list)));
      setTotal(list.length ? Number(list[0].total_count) : page === 0 ? 0 : total);
      if (photosVisible && list.length) {
        const { data: ph } = await supabase.from("product_color_photos").select("master_id,color_key,url_thumb,position,created_at")
          .in("master_id", list.map((r) => r.id)).order("position").order("created_at");
        if (!cancelled && ph) setThumbs((t) => ({ ...t, ...firstLegacyThumbnails(ph as any) }));
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page, photosVisible]);

  return (
    <section className="space-y-2">
      <p className="text-sm text-muted-foreground">{busy && rows.length === 0 ? "Carregando…" : `${total} produto${total === 1 ? "" : "s"} encontrado${total === 1 ? "" : "s"}`}</p>
      {error && <p className="text-sm text-destructive">Não consegui carregar a lista. Tente de novo.</p>}
      <ul className="space-y-2">
        {rows.map((h) => (
          <li key={h.id}>
            <Link to={`/m/estoque/produto/${h.id}`} className="flex min-h-[56px] items-center gap-3 rounded-lg border bg-card p-3">
              {thumbs[h.id]
                ? <img src={thumbs[h.id]} alt="" loading="lazy" width={56} height={56} className="h-14 w-14 shrink-0 rounded-md bg-muted object-cover" />
                : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-muted"><Package className="h-5 w-5 text-muted-foreground" /></span>}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="truncate font-medium">{h.name}</span>
                  {!h.is_active && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] uppercase text-muted-foreground">inativo</span>}</span>
                <span className="block text-xs text-muted-foreground">{Number(h.total_stock)} pares · {h.color_count} cor{h.color_count === 1 ? "" : "es"} · {h.size_count} tam.</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length < total && (
        <Button variant="outline" className="h-12 w-full" disabled={busy} onClick={() => setPage((p) => p + 1)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Carregar mais"}
        </Button>
      )}
    </section>
  );
}
