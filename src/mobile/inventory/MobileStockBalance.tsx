import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, Undo2, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTeamIdentity } from "@/hooks/chat/useTeamIdentity";
import { STOCK_LABEL_STORES } from "@/lib/labels/stockLabelApi";
import {
  closeCycle, getOpenCycle, loadConference, openCycle, resolveScannedCode, revertCycle, runZero, submitCounts,
  type CycleInfo, type ScannedVariant, type ZeroScope,
} from "@/lib/inventory/mobileCycleApi";
import {
  addScan, addUnknown, confirmMatches, deviceId, loadScan, markSent, pendingCount, pendingItems, saveScan, setQty,
  totalPairs, undoLast, type ScanState,
} from "./scanQueue";

const POSBarcodeScanner = lazy(() => import("@/components/pos/POSBarcodeScanner").then((m) => ({ default: m.POSBarcodeScanner })));
type Shell = React.ComponentType<{ title: string; back?: boolean; children: React.ReactNode }>;
type Conf = Awaited<ReturnType<typeof loadConference>>;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hhmm = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function feedback(ok: boolean) {
  try { navigator.vibrate?.(ok ? 40 : [80, 60, 80]); } catch { /* ignore */ }
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(); o.frequency.value = ok ? 1200 : 300; o.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
  } catch { /* ignore */ }
}

export function MobileStockBalance({ shell: Shell }: { shell: Shell }) {
  const { senderName } = useTeamIdentity();
  const userName = senderName || undefined;
  const dev = useRef(deviceId()).current;
  const [storeId, setStoreId] = useState("");
  const [cycle, setCycle] = useState<CycleInfo | null | undefined>(undefined);
  const [step, setStep] = useState<"count" | "conf" | "done">("count");
  const [scan, setScan] = useState<ScanState | null>(null);
  const [input, setInput] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [sending, setSending] = useState(false);
  const cache = useRef(new Map<string, ScannedVariant | null>());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCycle(undefined);
    if (storeId) getOpenCycle(storeId).then(setCycle).catch(() => setCycle(null));
  }, [storeId]);
  useEffect(() => { if (cycle) setScan(loadScan(cycle.id)); }, [cycle]);
  useEffect(() => { if (cycle && scan) saveScan(cycle.id, scan); }, [cycle, scan]);

  const send = useCallback(async (finished = false) => {
    if (!cycle || !scan || sending) return;
    const items = pendingItems(scan);
    setSending(true);
    try {
      await submitCounts({ cycleId: cycle.id, deviceId: dev, userName, items, pendingLeft: Math.max(0, pendingCount(scan) - items.length), finished });
      setScan((s) => (s ? markSent(s, items) : s));
    } catch (e: any) {
      if (navigator.onLine) toast.error("Não consegui enviar: " + (e?.message || "erro"));
    } finally { setSending(false); }
  }, [cycle, scan, sending, dev, userName]);

  const pend = scan ? pendingCount(scan) : 0;
  // Envio em lote: a cada 20 bipes pendentes, ou 30 s depois do último bipe, ou quando a internet volta.
  useEffect(() => {
    if (!pend || step !== "count") return;
    if (pend >= 20) { void send(); return; }
    const t = setTimeout(() => void send(), 30_000);
    return () => clearTimeout(t);
  }, [pend, step, send]);
  useEffect(() => {
    const on = () => void send();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [send]);

  async function handleCode(raw: string) {
    const code = raw.trim();
    setInput("");
    if (!code || !storeId) return;
    let v = cache.current.get(code);
    if (v === undefined) {
      try { v = await resolveScannedCode(code, storeId); cache.current.set(code, v); }
      catch { toast.error("Sem internet para reconhecer este código. Tente de novo."); feedback(false); return; }
    }
    if (!v) { setScan((s) => (s ? addUnknown(s, code) : s)); feedback(false); toast.warning(`Código ${code} não reconhecido`); return; }
    setScan((s) => (s ? addScan(s, v!.variant_id, { name: v!.name, color: v!.color, size: v!.size }) : s));
    setLast(v.variant_id);
    feedback(true);
    inputRef.current?.focus();
  }

  if (!storeId) {
    return (
      <Shell title="Balanço por bipagem" back>
        <p className="text-sm text-muted-foreground">Escolha a loja que vai ser contada.</p>
        {STOCK_LABEL_STORES.map((s) => <Button key={s.id} className="h-14 w-full text-base" variant="outline" onClick={() => setStoreId(s.id)}>{s.name}</Button>)}
      </Shell>
    );
  }
  const storeName = STOCK_LABEL_STORES.find((s) => s.id === storeId)?.name || "";
  if (cycle === undefined) return <Shell title={storeName} back><Loader2 className="mx-auto h-6 w-6 animate-spin" /></Shell>;
  if (cycle === null) {
    return (
      <Shell title={storeName} back>
        <p className="text-sm">Nenhum inventário aberto nesta loja.</p>
        <Button className="h-14 w-full text-base" onClick={async () => {
          try { await openCycle(storeId, userName); setCycle(await getOpenCycle(storeId)); }
          catch (e: any) { toast.error(e?.message || "Erro ao abrir"); }
        }}>Abrir inventário</Button>
      </Shell>
    );
  }
  if (!scan) return null;

  if (step === "conf") return <Conference Shell={Shell} cycle={cycle} storeName={storeName} myPending={pend} userName={userName}
    onBack={() => setStep("count")} onDone={() => setStep("done")} onSendNow={() => send(true)} />;
  if (step === "done") return <Done Shell={Shell} cycle={cycle} userName={userName} />;

  const lastEntry = last ? scan.entries[last] : null;
  const entries = Object.entries(scan.entries).filter(([, e]) => e.qty > 0).reverse();
  return (
    <Shell title={`Inventário #${cycle.numero} · ${storeName}`} back>
      <form onSubmit={(e) => { e.preventDefault(); void handleCode(input); }}>
        <Input ref={inputRef} autoFocus value={input} onChange={(e) => setInput(e.target.value)} enterKeyHint="done"
          placeholder="Bipe o código" aria-label="Código bipado" className="h-14 text-base" />
      </form>
      <Button variant="outline" className="h-12 w-full" onClick={() => setCamera(true)}><Camera className="mr-2 h-5 w-5" />Câmera</Button>
      {lastEntry && (
        <section className="rounded-lg border-2 border-primary bg-card p-4" aria-label="Último bipe">
          <p className="truncate font-semibold">{lastEntry.name}</p>
          <p className="text-sm text-muted-foreground">{[lastEntry.color, lastEntry.size].filter(Boolean).join(" · ")}</p>
          <p className="text-3xl font-bold">{lastEntry.qty} un</p>
        </section>
      )}
      <div className="flex items-center justify-between text-sm">
        <span><b>{totalPairs(scan)}</b> pares · {entries.length} variações</span>
        <span className={pend ? "text-destructive" : "text-muted-foreground"}>{pend ? `${pend} aguardando envio` : "tudo enviado"}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12" disabled={!scan.history.length} onClick={() => setScan(undoLast(scan))}><Undo2 className="mr-2 h-4 w-4" />Desfazer bipe</Button>
        <Button variant="outline" className="h-12" disabled={!pend || sending} onClick={() => send()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar agora"}</Button>
      </div>
      {Object.keys(scan.unknown).length > 0 && (
        <section className="rounded-lg border border-destructive/40 p-3 text-sm">
          <p className="mb-1 font-semibold">Não reconhecidos (não zeram nada)</p>
          {Object.entries(scan.unknown).map(([c, n]) => <p key={c}>{c} · {n}x</p>)}
        </section>
      )}
      <ul className="space-y-2">
        {entries.map(([id, e]) => (
          <li key={id} className="flex items-center gap-2 rounded-lg border bg-card p-2">
            <span className="min-w-0 flex-1 truncate text-sm">{e.name}<span className="block text-xs text-muted-foreground">{[e.color, e.size].filter(Boolean).join(" · ")}</span></span>
            <Input inputMode="numeric" aria-label={`Quantidade ${e.name} ${e.size || ""}`} className="h-11 w-16 text-center" value={e.qty}
              onChange={(ev) => /^\d+$/.test(ev.target.value) && setScan(setQty(scan, id, Number(ev.target.value)))} />
          </li>
        ))}
      </ul>
      <Button className="h-14 w-full text-base" onClick={async () => { await send(true); setStep("conf"); }}>Terminei — conferir antes de zerar</Button>
      {camera && (
        <div className="fixed inset-0 z-50 bg-background p-4">
          <Suspense fallback={<Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin" />}>
            <POSBarcodeScanner onClose={() => setCamera(false)} onScan={(c) => { setCamera(false); void handleCode(c); }} />
          </Suspense>
        </div>
      )}
    </Shell>
  );
}

function Conference({ Shell, cycle, storeName, myPending, userName, onBack, onDone, onSendNow }: {
  Shell: Shell; cycle: CycleInfo; storeName: string; myPending: number; userName?: string;
  onBack: () => void; onDone: () => void; onSendNow: () => Promise<void>;
}) {
  const [scope, setScope] = useState<ZeroScope>("touched");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Conf | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState<{ done: number; remaining: number } | null>(null);
  const stop = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await loadConference(cycle.id, scope, search)); }
    catch (e: any) { toast.error(e?.message || "Erro ao carregar"); }
    finally { setLoading(false); }
  }, [cycle.id, scope, search]);
  useEffect(() => { void load(); setTyped(""); setReviewed(false); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const othersPending = (data?.devices || []).some((d) => d.pending_left > 0);
  const blocked = myPending > 0 || othersPending;
  const canZero = !!data && !blocked && reviewed && allDone && confirmMatches(typed, data.zero_pairs);

  async function zero() {
    if (!data) return;
    stop.current = false;
    try {
      if (data.zero_variants > 0) {
        await runZero({ cycleId: cycle.id, scope, confirmPairs: data.zero_pairs, userName, shouldStop: () => stop.current,
          onProgress: (done, remaining) => setProgress({ done, remaining }) });
        if (stop.current) { toast.info("Zeramento parado. Você pode continuar depois."); return; }
      }
      await closeCycle(cycle.id, userName);
      onDone();
    } catch (e: any) { toast.error(e?.message || "Erro ao zerar"); }
  }

  return (
    <Shell title={`Conferência · ${storeName}`} back>
      <Button variant="ghost" className="h-11" onClick={onBack}>← Voltar a contar</Button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant={scope === "touched" ? "default" : "outline"} className="h-14 whitespace-normal text-sm" onClick={() => setScope("touched")}>Só produtos bipados (recomendado)</Button>
        <Button variant={scope === "store" ? "default" : "outline"} className="h-14 whitespace-normal text-sm" onClick={() => setScope("store")}>Loja inteira</Button>
      </div>
      <Button variant="outline" className="h-11 w-full" disabled={loading} onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
      {!data ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : (
        <>
          <section className="rounded-lg border bg-card p-4 text-sm">
            <p>Contados: <b>{data.counted_pairs}</b> pares em {data.counted_variants} variações</p>
            <p className="mt-2 text-base font-bold text-destructive">Serão ZERADOS: {data.zero_pairs} pares em {data.zero_variants} variações</p>
            <p className="text-muted-foreground">Custo {brl(Number(data.zero_cost))} · Venda {brl(Number(data.zero_sale))}</p>
            {scope === "store" && <p className="mt-2 flex gap-1 font-semibold text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />Isto zera {data.zero_pairs} pares da loja toda.</p>}
          </section>
          <section className="rounded-lg border bg-card p-3 text-sm">
            <p className="mb-1 font-semibold">Quem está contando</p>
            {data.devices.map((d) => (
              <p key={d.device_id} className={d.pending_left > 0 ? "text-destructive" : ""}>
                {d.user_name || "—"} · último envio {hhmm(d.last_sent_at)}{d.pending_left > 0 ? ` · ${d.pending_left} sem enviar` : d.finished ? " · terminou" : ""}
              </p>
            ))}
            {myPending > 0 && <Button className="mt-2 h-11 w-full" onClick={async () => { await onSendNow(); await load(); }}>Enviar meus {myPending} pendentes</Button>}
          </section>
          <form onSubmit={(e) => { e.preventDefault(); void load(); }}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar na lista" aria-label="Pesquisar" className="h-12" />
          </form>
          <details className="rounded-lg border p-3" open>
            <summary className="font-semibold">Lista do que será zerado</summary>
            {data.zero_list.map((z, i) => <p key={i} className="border-b py-1 text-sm">{z.product_name} · {[z.color, z.size].filter(Boolean).join(" ")} · <b>{z.stock}</b></p>)}
            {data.zero_variants > data.zero_list.length && <p className="pt-1 text-xs text-muted-foreground">Mostrando {data.zero_list.length} de {data.zero_variants}. Use a pesquisa.</p>}
          </details>
          <details className="rounded-lg border p-3">
            <summary className="font-semibold">Contados (quem contou quanto)</summary>
            {data.counted_list.map((c) => (
              <p key={c.variant_id} className="border-b py-1 text-sm">{c.product_name} · {[c.color, c.size].filter(Boolean).join(" ")} · <b>{c.total}</b>
                <span className="block text-xs text-muted-foreground">{c.by_person.map((p) => `${p.user_name}: ${p.qty}`).join(" · ")}</span></p>
            ))}
          </details>
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />Revisei a lista</label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={allDone} onChange={(e) => setAllDone(e.target.checked)} />Todas as pessoas terminaram de contar</label>
          <Input inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-14 text-center text-lg"
            aria-label="Digite o número de pares a zerar" placeholder={`Digite ${Math.round(Number(data.zero_pairs))} para confirmar`} />
          {blocked && <p className="text-sm text-destructive">Ainda há bipes sem enviar. Peça para todos enviarem e toque em Atualizar.</p>}
          {progress ? (
            <section className="space-y-2 text-sm">
              <p>Zerados {progress.done} · faltam {progress.remaining}</p>
              <Button variant="outline" className="h-12 w-full" onClick={() => { stop.current = true; }}>Parar</Button>
            </section>
          ) : (
            <Button className="h-14 w-full text-base" variant="destructive" disabled={!canZero} onClick={zero}>Concluir balanço e zerar</Button>
          )}
        </>
      )}
    </Shell>
  );
}

function Done({ Shell, cycle, userName }: { Shell: Shell; cycle: CycleInfo; userName?: string }) {
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  return (
    <Shell title={`Inventário #${cycle.numero} concluído`} back>
      <p className="text-sm">Balanço gravado. O relatório completo está em Estoque &gt; Inventário no computador.</p>
      <p className="text-sm text-muted-foreground">Dá para desfazer este balanço por até 2 dias.</p>
      {!sure ? <Button variant="outline" className="h-14 w-full" onClick={() => setSure(true)}>Desfazer este balanço</Button> : (
        <Button variant="destructive" className="h-14 w-full" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const r = await revertCycle(cycle.id, userName);
            toast.success(`${r.reverted_batches} lote(s) desfeito(s).`);
            if (r.skipped.length) toast.warning(r.skipped.map((s) => `Lote #${s.numero}: ${s.reason}`).join("\n"));
          } catch (e: any) { toast.error(e?.message || "Erro ao desfazer"); }
          finally { setBusy(false); }
        }}>Confirmar: desfazer tudo</Button>
      )}
    </Shell>
  );
}
