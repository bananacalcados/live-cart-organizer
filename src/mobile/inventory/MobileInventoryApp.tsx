import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2, Monitor, Package, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProductColorPhotosMode } from "@/hooks/useProductColorPhotosMode";
import { loadSheet, searchMasters, stockByVariant, MobileMasterHit } from "./data";
import { setDesktopPreference } from "./redirect";
import { MobileColorPhotos } from "./MobileColorPhotos";

const POSBarcodeScanner = lazy(() => import("@/components/pos/POSBarcodeScanner").then((m) => ({ default: m.POSBarcodeScanner })));
const brl = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function Shell({ title, back, children }: { title: string; back?: boolean; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background px-3">
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Voltar"
          onClick={() => (back ? navigate(-1) : navigate("/"))}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h1>
      </header>
      <main className="mx-auto w-full max-w-md space-y-4 p-4">{children}</main>
    </div>
  );
}

function SearchHome() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<MobileMasterHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function run(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await searchMasters(q);
      if (r.exactMasterId) { navigate(`/m/estoque/produto/${r.exactMasterId}`); return; }
      setHits(r.hits);
    } finally { setBusy(false); }
  }

  return (
    <Shell title="Estoque">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(term); }}>
        <Input ref={inputRef} value={term} onChange={(e) => setTerm(e.target.value)} enterKeyHint="search"
          placeholder="Bipe ou digite nome/código" aria-label="Buscar produto" className="h-14 text-base" />
        <Button type="submit" className="h-14 w-14 shrink-0" aria-label="Buscar" disabled={busy}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
        </Button>
      </form>
      <Button variant="outline" className="h-14 w-full text-base" onClick={() => setScan(true)}>
        <Camera className="mr-2 h-5 w-5" /> Ler código pela câmera
      </Button>
      {hits && hits.length === 0 && <p className="text-center text-sm text-muted-foreground">Nenhum produto encontrado.</p>}
      <ul className="space-y-2">
        {(hits || []).map((h) => (
          <li key={h.id}>
            <Link to={`/m/estoque/produto/${h.id}`} className="flex min-h-[56px] items-center gap-3 rounded-lg border bg-card p-3">
              <Package className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{h.name}</span>
                <span className="block text-xs text-muted-foreground">{h.sku_root} · {brl(h.sale_price)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <button className="mx-auto flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground underline"
        onClick={() => { setDesktopPreference(true); navigate("/inventory"); }}>
        <Monitor className="h-4 w-4" /> Ver versão completa
      </button>
      {scan && (
        <div className="fixed inset-0 z-50 bg-background p-4">
          <Suspense fallback={<Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin" />}>
            <POSBarcodeScanner onClose={() => setScan(false)} onScan={(code) => { setScan(false); setTerm(code); run(code); }} />
          </Suspense>
        </div>
      )}
    </Shell>
  );
}

function ProductSheet() {
  const { masterId = "" } = useParams();
  const { data: mode } = useProductColorPhotosMode(true);
  const photosOn = !!mode?.visible;
  const { data, isLoading } = useQuery({ queryKey: ["m-sheet", masterId, photosOn], queryFn: () => loadSheet(masterId, photosOn), enabled: !!masterId });
  if (isLoading) return <Shell title="Produto" back><Loader2 className="mx-auto h-6 w-6 animate-spin" /></Shell>;
  if (!data) return <Shell title="Produto" back><p className="text-sm text-muted-foreground">Produto não encontrado.</p></Shell>;
  const rows = stockByVariant(data);
  const total = rows.reduce((a, r) => a + r.total, 0);
  return (
    <Shell title={data.master.name} back>
      {data.photos[0] && <img src={data.photos[0].url_medium} alt="" loading="lazy" className="aspect-square w-full rounded-lg bg-muted object-cover" />}
      <section className="rounded-lg border bg-card p-4">
        <p className="text-sm text-muted-foreground">{data.master.sku_root}{data.master.brand ? ` · ${data.master.brand}` : ""}</p>
        <p className="text-2xl font-bold">{brl(data.master.sale_price)}</p>
        <p className="text-sm">{total} pares no total</p>
      </section>
      {data.photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {data.photos.map((p, i) => <img key={i} src={p.url_thumb} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded bg-muted object-cover" />)}
        </div>
      )}
      {photosOn && <MobileColorPhotos masterId={masterId} variantColors={[...new Set(data.variants.map((v) => v.color || "").filter(Boolean))]} />}
      <ul className="space-y-2">
        {rows.map(({ variant: v, total: t, perStore }) => (
          <li key={v.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{[v.color, v.size].filter(Boolean).join(" · ") || "Única"}</span>
              <span className={t > 0 ? "font-bold" : "text-muted-foreground"}>{t} un</span>
            </div>
            {v.sale_price_override ? <p className="text-xs text-muted-foreground">Preço próprio {brl(v.sale_price_override)}</p> : null}
            {perStore.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{perStore.map((s) => `${s.store}: ${s.qty}`).join(" · ")}</p>}
          </li>
        ))}
      </ul>
    </Shell>
  );
}

export default function MobileInventoryApp() {
  return (
    <Routes>
      <Route index element={<SearchHome />} />
      <Route path="produto/:masterId" element={<ProductSheet />} />
    </Routes>
  );
}
