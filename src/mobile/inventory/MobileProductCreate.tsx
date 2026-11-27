import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Minus, Plus, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { GENDER_VALUES } from "@/lib/productGender";
import { sanitizeSizeInput } from "@/lib/variantValidation";
import { STOCK_LABEL_STORES, applyStockLabelBatch } from "@/lib/labels/stockLabelApi";
import { buildLabelPdf, expandLabels } from "@/lib/labels/labelPdf";
import {
  DESKTOP_DEFAULTS, MasterDraft, SIZE_CHOICES, SIZE_GRIDS, VariantDraft, CreatedVariant, buildCombos, comboKey, duplicateIdFrom,
  emptyMaster, fiscalWarnings, labelQuantities, masterPayload, parseQty, stepQty, totalPairs, validateCreate, variantsPayload,
} from "./productCreate";

type ShellT = (p: { title: string; back?: boolean; children: React.ReactNode }) => JSX.Element;
const lbl = "mb-1 block text-sm font-medium";
const big = "h-12 text-base";

function useCatalogs() {
  return useQuery({
    queryKey: ["m-product-catalogs"], staleTime: 10 * 60_000,
    queryFn: async () => {
      const [c, b, col] = await Promise.all([
        supabase.from("product_categories").select("id,name").order("name"),
        supabase.from("product_brands" as any).select("id,name").order("name"),
        supabase.from("product_colors" as any).select("name").order("name").limit(300),
      ]);
      return {
        categories: (c.data || []) as { id: string; name: string }[],
        brands: ((b.data || []) as any[]) as { id: string; name: string }[],
        colors: [...new Set(((col.data || []) as any[]).map((x) => String(x.name || "").trim()).filter(Boolean))],
      };
    },
  });
}

function Section({ title, summary, warn, open: initial = false, children }: { title: string; summary?: string; warn?: boolean; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="rounded-lg border bg-card">
      <button type="button" className="flex min-h-[52px] w-full items-center gap-2 px-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex-1"><span className="block font-semibold">{title}</span>
          {summary && <span className={`block text-xs ${warn ? "text-destructive" : "text-muted-foreground"}`}>{summary}</span>}</span>
        <ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-3 border-t p-4">{children}</div>}
    </section>
  );
}

/** Todos os campos do produto pai que o computador tem. */
export function MasterFields({ m, set, nameHints }: { m: MasterDraft; set: (p: Partial<MasterDraft>) => void; nameHints?: React.ReactNode }) {
  const { data: cat } = useCatalogs();
  const warns = fiscalWarnings(m);
  return (
    <div className="space-y-3">
      <Section title="Dados principais" open summary={m.name || "Nome, categoria, marca, gênero"}>
        <div><label className={lbl}>Nome *</label><Input className={big} value={m.name} onChange={(e) => set({ name: e.target.value })} />{nameHints}</div>
        <div><label className={lbl}>Categoria</label>
          <Input className={big} list="m-cats" value={m.category} placeholder="Escolha ou digite"
            onChange={(e) => { const c = cat?.categories.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase()); set({ category: e.target.value, categoryId: c?.id || "" }); }} />
          <datalist id="m-cats">{cat?.categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          {m.category && !m.categoryId && <p className="mt-1 text-xs text-muted-foreground">Categoria nova (texto livre, como no computador).</p>}
        </div>
        <div><label className={lbl}>Marca</label>
          <Input className={big} list="m-brands" value={m.brand} placeholder="Escolha ou digite" onChange={(e) => set({ brand: e.target.value })} />
          <datalist id="m-brands">{cat?.brands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
        </div>
        <div><label className={lbl}>Gênero</label>
          <select className="h-12 w-full rounded-md border bg-background px-3 text-base" value={m.gender} onChange={(e) => set({ gender: e.target.value })}>
            <option value="">—</option>{GENDER_VALUES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select></div>
      </Section>
      <Section title="Preço e custo" summary={`Venda ${m.salePrice || "—"} · Custo ${m.costPrice || "—"}`}>
        <div><label className={lbl}>Preço de venda (R$)</label><Input className={big} inputMode="decimal" value={m.salePrice} onChange={(e) => set({ salePrice: e.target.value.replace(",", ".") })} /></div>
        <div><label className={lbl}>Preço de custo (R$)</label><Input className={big} inputMode="decimal" value={m.costPrice} onChange={(e) => set({ costPrice: e.target.value.replace(",", ".") })} /></div>
      </Section>
      <Section title="Fiscal" warn={warns.length > 0}
        summary={`NCM ${m.ncm || "—"} · CEST ${m.cest || "—"} · Origem ${DESKTOP_DEFAULTS.origem} · ${DESKTOP_DEFAULTS.unidade}${warns.length ? " · Falta: " + warns.join(", ") : ""}`}>
        <div><label className={lbl}>NCM</label><Input className={big} inputMode="numeric" value={m.ncm} onChange={(e) => set({ ncm: e.target.value })} /></div>
        <div><label className={lbl}>CEST</label><Input className={big} inputMode="numeric" value={m.cest} onChange={(e) => set({ cest: e.target.value })} /></div>
        <p className="text-xs text-muted-foreground">Origem {DESKTOP_DEFAULTS.origem} e unidade {DESKTOP_DEFAULTS.unidade} são gravadas automaticamente, igual ao computador. CFOP/CST vêm da regra fiscal pelo NCM na hora da nota.</p>
        {warns.length > 0 && <p className="text-sm text-destructive">O produto fica marcado para revisão: {warns.join(", ")}.</p>}
      </Section>
      <Section title="Peso e dimensões" summary={`${m.weight || "—"} kg · ${m.height || "—"}×${m.width || "—"}×${m.length || "—"} cm`}>
        <div className="grid grid-cols-2 gap-2">
          {([["weight", "Peso (kg)"], ["height", "Altura (cm)"], ["width", "Largura (cm)"], ["length", "Compr. (cm)"]] as const).map(([k, t]) => (
            <div key={k}><label className={lbl}>{t}</label><Input className={big} inputMode="decimal" value={m[k]} onChange={(e) => set({ [k]: e.target.value.replace(",", ".") } as any)} /></div>
          ))}
        </div>
      </Section>
      <Section title="Outros" summary={m.description ? "Com descrição" : "Descrição"}>
        <div><label className={lbl}>Descrição</label><Textarea rows={3} value={m.description} onChange={(e) => set({ description: e.target.value })} /></div>
      </Section>
    </div>
  );
}

function ColorSizePicker({ colors, setColors, sizes, setSizes }: { colors: string[]; setColors: (c: string[]) => void; sizes: string[]; setSizes: (s: string[]) => void }) {
  const { data: cat } = useCatalogs();
  const [c, setC] = useState(""); const [s, setS] = useState("");
  const addColor = (v: string) => { const t = v.trim(); if (t && !colors.some((x) => comboKey(x, "") === comboKey(t, ""))) setColors([...colors, t]); setC(""); };
  const toggle = (z: string) => setSizes(sizes.includes(z) ? sizes.filter((x) => x !== z) : [...sizes, z]);
  const extra = sizes.filter((z) => !SIZE_CHOICES.includes(z));
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="font-semibold">Cores</h3>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addColor(c); }}>
          <Input className={big} list="m-colors" value={c} onChange={(e) => setC(e.target.value)} placeholder="Digite ou escolha" />
          <datalist id="m-colors">{cat?.colors.map((x) => <option key={x} value={x} />)}</datalist>
          <Button type="submit" className="h-12 w-12 shrink-0" aria-label="Adicionar cor"><Plus className="h-5 w-5" /></Button>
        </form>
        <div className="flex flex-wrap gap-2">{colors.map((x) => (
          <button key={x} type="button" className="flex min-h-[44px] items-center gap-1 rounded-full border bg-primary px-4 text-sm text-primary-foreground" onClick={() => setColors(colors.filter((y) => y !== x))}>{x}<X className="h-4 w-4" /></button>
        ))}</div>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Tamanhos</h3>
        <div className="flex flex-wrap gap-2">{SIZE_GRIDS.map((g) => (
          <button key={g.label} type="button" className="min-h-[44px] rounded-full border bg-card px-4 text-sm" onClick={() => setSizes([...new Set([...sizes, ...g.sizes])])}>{g.label}</button>
        ))}</div>
        <div className="grid grid-cols-6 gap-2">{[...SIZE_CHOICES, ...extra].map((z) => (
          <button key={z} type="button" aria-pressed={sizes.includes(z)} onClick={() => toggle(z)}
            className={`min-h-[44px] rounded-md border text-sm font-medium ${sizes.includes(z) ? "bg-primary text-primary-foreground" : "bg-card"}`}>{z}</button>
        ))}</div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = s.trim(); if (t && !sizes.includes(t)) setSizes([...sizes, t]); setS(""); }}>
          <Input className={big} value={s} onChange={(e) => setS(sanitizeSizeInput(e.target.value))} placeholder="Outro tamanho (ex.: 34/35)" />
          <Button type="submit" variant="outline" className="h-12 shrink-0">Incluir</Button>
        </form>
        {sizes.length > 0 && <button type="button" className="min-h-[44px] text-sm text-muted-foreground underline" onClick={() => setSizes([])}>Desmarcar todos</button>}
      </section>
    </div>
  );
}

function StorePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">{STOCK_LABEL_STORES.map((s) => (
      <button key={s.id} type="button" aria-pressed={value === s.id} onClick={() => onChange(s.id)}
        className={`min-h-[52px] rounded-lg border text-base font-medium ${value === s.id ? "bg-primary text-primary-foreground" : "bg-card"}`}>{s.name}</button>
    ))}</div>
  );
}

function QtyList({ rows, setRows, existing = [] }: { rows: VariantDraft[]; setRows: (r: VariantDraft[]) => void; existing?: { color: string; size: string }[] }) {
  const [adv, setAdv] = useState<number | null>(null);
  const upd = (i: number, p: Partial<VariantDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <ul className="space-y-2">
      {existing.map((e) => (
        <li key={`x-${e.color}-${e.size}`} className="flex min-h-[52px] items-center gap-2 rounded-lg border bg-muted px-3 text-muted-foreground">
          <span className="flex-1 truncate">{e.color} · {e.size}</span><span className="text-xs">já existe</span></li>
      ))}
      {rows.map((r, i) => (
        <li key={`${r.color}-${r.size}`} className="rounded-lg border bg-card p-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{r.color} · {r.size}</span>
            <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Menos" onClick={() => upd(i, { qty: stepQty(r.qty, -1) })}><Minus className="h-4 w-4" /></Button>
            <Input className="h-11 w-16 text-center text-lg" inputMode="numeric" value={r.qty} placeholder="0" aria-label={`Saldo ${r.color} ${r.size}`} onChange={(e) => upd(i, { qty: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
            <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Mais" onClick={() => upd(i, { qty: stepQty(r.qty, 1) })}><Plus className="h-4 w-4" /></Button>
          </div>
          <button type="button" className="mt-1 min-h-[36px] text-xs text-muted-foreground underline" onClick={() => setAdv(adv === i ? null : i)}>Avançado</button>
          {adv === i && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input className="h-11" inputMode="decimal" placeholder="Preço próprio" value={r.sale || ""} onChange={(e) => upd(i, { sale: e.target.value.replace(",", ".") })} />
              <Input className="h-11" inputMode="decimal" placeholder="Custo próprio" value={r.cost || ""} onChange={(e) => upd(i, { cost: e.target.value.replace(",", ".") })} />
              <Input className="h-11" inputMode="decimal" placeholder="Peso próprio (kg)" value={r.weight || ""} onChange={(e) => upd(i, { weight: e.target.value.replace(",", ".") })} />
              {"sku" in r && <>
                <Input className="h-11" placeholder="SKU (automático)" value={r.sku || ""} onChange={(e) => upd(i, { sku: e.target.value })} />
                <Input className="col-span-2 h-11" inputMode="numeric" placeholder="Código de barras (automático)" value={r.gtin || ""} onChange={(e) => upd(i, { gtin: e.target.value.replace(/\D/g, "") })} />
              </>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Success({ shell: Shell, result, name, price }: { shell: ShellT; result: { master_id: string; store_id: string; variants: CreatedVariant[] }; name: string; price: number | null }) {
  const [pdf, setPdf] = useState<{ url: string; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(false);
  const pairs = totalPairs(result.variants);
  async function makePdf() {
    setBusy(true);
    try {
      if (!registered) {
        const { data: now, error } = await supabase.rpc("server_now");
        if (error) throw error;
        await applyStockLabelBatch({ storeId: result.store_id, mode: "print_only", masterId: result.master_id, scope: "selected", openedAt: now as unknown as string,
          items: result.variants.filter((v) => v.qty > 0).map((v) => ({ variant_id: v.id, qty: v.qty })) });
        setRegistered(true);
      }
    } catch (e: any) { toast.warning("PDF gerado, mas não consegui registrar a impressão: " + (e?.message || "erro")); }
    const blob = buildLabelPdf(expandLabels(result.variants, labelQuantities(result.variants), name, price));
    const file = new File([blob], `etiquetas-${name.replace(/[^\w-]+/g, "_").slice(0, 40) || "produto"}.pdf`, { type: "application/pdf" });
    if (pdf) URL.revokeObjectURL(pdf.url);
    setPdf({ url: URL.createObjectURL(blob), file });
    setBusy(false);
  }
  return (
    <Shell title="Pronto!">
      <section className="rounded-lg border bg-card p-4">
        <p className="text-lg font-bold">{name}</p>
        <p className="text-sm text-muted-foreground">{result.variants.length} variação(ões) criada(s) · {pairs} par(es) lançado(s) em {STOCK_LABEL_STORES.find((s) => s.id === result.store_id)?.name}</p>
      </section>
      {pairs > 0 && <Button className="h-14 w-full text-base" disabled={busy} onClick={makePdf}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : `Baixar PDF das etiquetas (${pairs})`}</Button>}
      {pdf && <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline" className="h-12"><a href={pdf.url} download={pdf.file.name}>Baixar de novo</a></Button>
        {typeof navigator !== "undefined" && (navigator as any).canShare?.({ files: [pdf.file] })
          ? <Button variant="outline" className="h-12" onClick={() => navigator.share({ files: [pdf.file], title: "Etiquetas" }).catch(() => {})}><Share2 className="mr-2 h-4 w-4" />Compartilhar</Button>
          : <Button asChild variant="outline" className="h-12"><a href={pdf.url} target="_blank" rel="noreferrer">Abrir PDF</a></Button>}
      </div>}
      <Button asChild variant="outline" className="h-14 w-full text-base"><Link to={`/m/estoque/produto/${result.master_id}`}>Abrir produto</Link></Button>
    </Shell>
  );
}

const STEPS = ["Dados", "Cores e tamanhos", "Saldo", "Revisão"];

export function MobileNewProduct({ shell: Shell }: { shell: ShellT }) {
  const [step, setStep] = useState(0);
  const [m, setM] = useState<MasterDraft>(emptyMaster);
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [rows, setRows] = useState<VariantDraft[]>([]);
  const [storeId, setStoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [hints, setHints] = useState<{ id: string; name: string; exact: boolean }[]>([]);
  const [dupId, setDupId] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const set = (p: Partial<MasterDraft>) => setM((x) => ({ ...x, ...p }));

  useEffect(() => {
    const term = m.name.trim();
    if (term.length < 3) { setHints([]); return; }
    let off = false;
    const t = setTimeout(() => {
      (supabase.rpc as any)("mobile_product_name_hints", { p_term: term, p_limit: 5 }).then(({ data }: any) => { if (!off) setHints(data || []); });
    }, 400);
    return () => { off = true; clearTimeout(t); };
  }, [m.name]);
  const exact = hints.find((h) => h.exact);
  const combos = useMemo(() => buildCombos(colors, sizes), [colors, sizes]);
  useEffect(() => {
    setRows((prev) => combos.map((c) => prev.find((p) => comboKey(p.color, p.size) === comboKey(c.color, c.size)) || { color: c.color, size: c.size, qty: "" }));
  }, [combos]);

  if (result) return <Success shell={Shell} result={result} name={m.name.trim()} price={parseFloat(m.salePrice) || null} />;

  async function create() {
    const err = validateCreate(m, storeId, rows);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("mobile_create_product", {
        p_request_id: requestId, p_master: masterPayload(m), p_variants: variantsPayload(rows, m.costPrice, m.salePrice), p_store_id: storeId, p_gender: m.gender || null,
      });
      if (error) throw error;
      setResult(data);
    } catch (e: any) {
      const d = duplicateIdFrom(e?.message);
      if (d) { setDupId(d); setStep(0); toast.error("Já existe um produto com esse nome."); }
      else toast.error((e?.message || "Não consegui criar.") + " Pode tentar de novo: não vai duplicar.");
    } finally { setBusy(false); }
  }
  const pairs = rows.reduce((a, r) => a + parseQty(r.qty), 0);
  const nextOk = step === 0 ? !!m.name.trim() && !exact : step === 1 ? combos.length > 0 : step === 2 ? !!storeId : true;
  const hintBox = (
    <>
      {(exact || dupId) && <p className="mt-1 text-sm text-destructive">Já existe um produto com esse nome. <Link className="underline" to={`/m/estoque/produto/${exact?.id || dupId}`}>Abrir o existente</Link></p>}
      {!exact && hints.length > 0 && <div className="mt-1 text-xs text-muted-foreground">Parecidos: {hints.map((h, i) => <span key={h.id}>{i > 0 && " · "}<Link className="underline" to={`/m/estoque/produto/${h.id}`}>{h.name}</Link></span>)}</div>}
    </>
  );
  return (
    <Shell title="Novo produto" back>
      <div className="flex gap-1" aria-label={`Etapa ${step + 1} de ${STEPS.length}`}>{STEPS.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded ${i <= step ? "bg-primary" : "bg-muted"}`} />)}</div>
      <p className="text-sm font-medium">{step + 1}. {STEPS[step]}</p>
      {step === 0 && <MasterFields m={m} set={(p) => { set(p); if ("name" in p) setDupId(null); }} nameHints={hintBox} />}
      {step === 1 && <ColorSizePicker colors={colors} setColors={setColors} sizes={sizes} setSizes={setSizes} />}
      {step === 2 && <>
        <p className="text-sm">Loja que recebe o saldo (as outras lojas nascem com zero):</p>
        <StorePicker value={storeId} onChange={setStoreId} />
        <p className="text-sm text-muted-foreground">Saldo por variação (vazio = 0):</p>
        <QtyList rows={rows} setRows={setRows} />
      </>}
      {step === 3 && (
        <section className="space-y-2 rounded-lg border bg-card p-4">
          <p className="font-bold">{m.name}</p>
          <p className="text-sm">Serão criadas <b>{rows.length}</b> variações · <b>{pairs}</b> pares na {STOCK_LABEL_STORES.find((s) => s.id === storeId)?.name}</p>
          <p className="text-sm text-muted-foreground">Venda {m.salePrice || "—"} · Custo {m.costPrice || "—"} · NCM {m.ncm}</p>
          {fiscalWarnings(m).length > 0 && <p className="text-sm text-destructive">Atenção: {fiscalWarnings(m).join(", ")} (fica marcado para revisão).</p>}
          <ul className="text-sm">{rows.map((r) => <li key={`${r.color}-${r.size}`}>{r.color} · {r.size}: {parseQty(r.qty)}</li>)}</ul>
          <p className="text-xs text-muted-foreground">Nada é publicado na Shopify.</p>
        </section>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-14" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Voltar</Button>
        {step < 3
          ? <Button className="h-14" disabled={!nextOk} onClick={() => setStep(step + 1)}>Continuar</Button>
          : <Button className="h-14" disabled={busy || !!dupId} onClick={create}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Criar produto"}</Button>}
      </div>
    </Shell>
  );
}

export function MobileAddVariants({ shell: Shell }: { shell: ShellT }) {
  const { masterId = "" } = useParams();
  const { data } = useQuery({
    queryKey: ["m-add-var", masterId], enabled: !!masterId,
    queryFn: async () => {
      const [m, v] = await Promise.all([
        supabase.from("products_master").select("id,name,sale_price,cost_price").eq("id", masterId).maybeSingle(),
        supabase.from("product_variants").select("color,size").eq("master_id", masterId),
      ]);
      return { master: m.data as any, variants: (v.data || []) as { color: string | null; size: string | null }[] };
    },
  });
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [rows, setRows] = useState<VariantDraft[]>([]);
  const [storeId, setStoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<any>(null);
  useEffect(() => { if (data) setColors((c) => (c.length ? c : [...new Set(data.variants.map((v) => v.color || "").filter(Boolean))])); }, [data]);
  const combos = useMemo(() => buildCombos(colors, sizes, data?.variants || []), [colors, sizes, data]);
  useEffect(() => {
    setRows((prev) => combos.filter((c) => !c.exists).map((c) => prev.find((p) => comboKey(p.color, p.size) === comboKey(c.color, c.size)) || { color: c.color, size: c.size, qty: "", sku: "", gtin: "" }));
  }, [combos]);
  if (!data?.master) return <Shell title="Adicionar cor / tamanho" back><Loader2 className="mx-auto h-6 w-6 animate-spin" /></Shell>;
  if (result) return <Success shell={Shell} result={result} name={data.master.name} price={data.master.sale_price} />;
  async function save() {
    const err = validateCreate({ ...emptyMaster(), name: data!.master.name }, storeId, rows);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const { data: r, error } = await (supabase.rpc as any)("mobile_add_variants", {
        p_request_id: requestId, p_master_id: masterId, p_variants: variantsPayload(rows, String(data!.master.cost_price ?? ""), String(data!.master.sale_price ?? "")), p_store_id: storeId,
      });
      if (error) throw error;
      setResult(r);
    } catch (e: any) { toast.error((e?.message || "Não consegui criar.") + " Pode tentar de novo: não vai duplicar."); }
    finally { setBusy(false); }
  }
  const existing = combos.filter((c) => c.exists);
  return (
    <Shell title="Adicionar cor / tamanho" back>
      <p className="truncate text-sm text-muted-foreground">{data.master.name}</p>
      <ColorSizePicker colors={colors} setColors={setColors} sizes={sizes} setSizes={setSizes} />
      <p className="text-sm">Loja que recebe o saldo:</p>
      <StorePicker value={storeId} onChange={setStoreId} />
      <p className="text-sm">Serão criadas <b>{rows.length}</b> variações{existing.length ? ` (${existing.length} já existem)` : ""}:</p>
      <QtyList rows={rows} setRows={setRows} existing={existing} />
      <Button className="h-14 w-full text-base" disabled={busy || !rows.length || !storeId} onClick={save}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Criar variações"}</Button>
    </Shell>
  );
}

/** Edição do pai: mesmos campos e mesma gravação do "Editar produto" do computador. */
export function MobileEditProduct({ shell: Shell }: { shell: ShellT }) {
  const { masterId = "" } = useParams();
  const navigate = useNavigate();
  const [m, setM] = useState<MasterDraft | null>(null);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const { data: cat } = useCatalogs();
  useEffect(() => {
    supabase.from("products_master").select("name,description,brand,category,category_id,gender,ncm,cest,cost_price,sale_price,weight_kg,height_cm,width_cm,length_cm,is_active")
      .eq("id", masterId).maybeSingle().then(({ data: d }: any) => {
        if (!d) return;
        setActive(d.is_active !== false);
        setM({ name: d.name || "", description: d.description || "", brand: d.brand || "", category: d.category || "", categoryId: d.category_id || "",
          gender: d.gender || "", ncm: d.ncm || "", cest: d.cest || "", costPrice: d.cost_price?.toString() || "", salePrice: d.sale_price?.toString() || "",
          weight: d.weight_kg?.toString() || "", height: d.height_cm?.toString() || "", width: d.width_cm?.toString() || "", length: d.length_cm?.toString() || "" });
      });
  }, [masterId]);
  if (!m) return <Shell title="Editar produto" back><Loader2 className="mx-auto h-6 w-6 animate-spin" /></Shell>;
  async function save() {
    if (!m!.name.trim()) { toast.error("Informe o nome do produto."); return; }
    setBusy(true);
    try {
      const brandTrim = m!.brand.trim();
      if (brandTrim && !cat?.brands.some((b) => b.name.toLowerCase() === brandTrim.toLowerCase())) {
        const slug = brandTrim.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        await supabase.from("product_brands" as any).insert({ name: brandTrim, slug } as any);
      }
      const { error } = await supabase.from("products_master").update({
        name: m!.name, description: m!.description, brand: m!.brand, category: m!.category, category_id: m!.categoryId || null,
        gender: m!.gender || null, gender_source: m!.gender ? "manual" : null, ncm: m!.ncm, cest: m!.cest,
        cost_price: parseFloat(m!.costPrice) || 0, sale_price: parseFloat(m!.salePrice) || 0,
        weight_kg: parseFloat(m!.weight) || null, height_cm: parseFloat(m!.height) || null, width_cm: parseFloat(m!.width) || null, length_cm: parseFloat(m!.length) || null,
        is_active: active, updated_at: new Date().toISOString(),
      } as any).eq("id", masterId);
      if (error) throw error;
      const { data: vs } = await supabase.from("product_variants").select("sku").eq("master_id", masterId);
      const skus = (vs || []).map((v: any) => v.sku).filter(Boolean);
      if (skus.length) await supabase.from("pos_products").update({ category: m!.category || null, category_id: m!.categoryId || null, ...(m!.gender ? { gender: m!.gender, gender_source: "manual" } : {}) } as any).in("sku", skus);
      toast.success("Produto salvo.");
      navigate(`/m/estoque/produto/${masterId}`, { replace: true });
    } catch (e: any) { toast.error("Erro ao salvar: " + (e?.message || "")); }
    finally { setBusy(false); }
  }
  return (
    <Shell title="Editar produto" back>
      <MasterFields m={m} set={(p) => setM((x) => ({ ...(x as MasterDraft), ...p }))} />
      <label className="flex min-h-[52px] items-center gap-3 rounded-lg border bg-card px-4">
        <input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} /> Produto ativo
      </label>
      <Button className="h-14 w-full text-base" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar"}</Button>
    </Shell>
  );
}
