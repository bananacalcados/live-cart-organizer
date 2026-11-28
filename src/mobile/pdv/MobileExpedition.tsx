import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Monitor, Package, RefreshCw, ScanBarcode, Undo2, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { usePdvStoreEvents } from "@/hooks/usePdvStoreEvents";
import { useItemPhotos } from "@/hooks/useItemPhotos";
import { ItemPhotoThumb } from "@/components/pos/ItemPhotoThumb";
import { itemPhotoKey } from "@/lib/pos/itemPhotoCache";
import { EXP_STAGES, fetchExpeditionOrders, nextStage, type ExpOrder, type ExpStage } from "@/lib/pos/expedition";
import { expeditionShippingError, finishExpedition, moveExpeditionOrders, type ExpeditionShipping } from "@/lib/pos/expeditionActions";
import { isSedexOrder } from "@/lib/expeditionPriority";
import { useExpeditionOutbox } from "./useExpeditionOutbox";
import { MobilePdvCamera } from "./MobilePdvCamera";
import { fullVersionUrl } from "./sections";
import { setPdvDesktopPreference } from "./redirect";

function FullExpedition({ label = "Versão completa" }: { label?: string }) {
  return <Button asChild variant="outline" className="h-12 w-full"><Link to={fullVersionUrl("expedicao")} onClick={() => setPdvDesktopPreference(true)}><Monitor className="mr-2 h-5 w-5" />{label}</Link></Button>;
}

function feedback(ok: boolean) {
  navigator.vibrate?.(ok ? 60 : [100, 70, 100]);
  try {
    const ctx = new AudioContext(); const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
    oscillator.frequency.value = ok ? 880 : 220; gain.gain.value = 0.12;
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + (ok ? 0.1 : 0.25));
    oscillator.onended = () => { void ctx.close(); };
  } catch { /* Sound is best-effort; visible feedback always remains. */ }
}

function MobileConference({ order, userId, onClose, onRefresh }: { order: ExpOrder; userId: string; onClose: () => void; onRefresh: () => void }) {
  const outbox = useExpeditionOutbox(order, userId);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [lastItemId, setLastItemId] = useState(order.items[0]?.id || "");
  const [checks, setChecks] = useState<Record<string, { feet_ok: boolean; has_defect: boolean }>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const photos = useItemPhotos(order.items.map(itemPhotoKey));
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const scanned = Object.values(outbox.totals).reduce((sum, total) => sum + total, 0);
  const featured = order.items.find(item => item.id === lastItemId) || order.items[0];
  const shipping: ExpeditionShipping = { carrier: order.shipping_carrier || order.delivery_method || "", tracking: order.tracking_code || "",
    trackingUrl: order.tracking_url || "", deliveryDays: order.delivery_days || "", courier: order.courier_name || "",
    cost: order.shipping_cost == null ? NaN : Number(order.shipping_cost), storeId: order.store_id };
  const missingShipping = expeditionShippingError(shipping);
  const complete = order.items.every(item => (outbox.totals[item.id] || 0) === item.quantity && checks[item.id]?.feet_ok);
  useEffect(() => { if (!camera) input.current?.focus(); }, [camera]);
  const scan = async (raw: string) => {
    try {
      const item = await outbox.scan(raw);
      if (item) { setLastItemId(item.id); setMessage(`Conferido: ${item.product_name || "Item"}`); feedback(true); }
      else setMessage("Bipe guardado; aguardando validação.");
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Não consegui registrar o bipe"); feedback(false); }
    finally { setCode(""); if (!camera) input.current?.focus(); }
  };
  const conclude = async () => {
    if (!complete || outbox.pending || outbox.stale || outbox.invalid || !outbox.online) return;
    setBusy(true);
    try {
      const result = await finishExpedition(order, Object.fromEntries(order.items.map(item => [item.id, { scanned: true, feet_ok: !!checks[item.id]?.feet_ok, has_defect: !!checks[item.id]?.has_defect }])), shipping);
      outbox.reset(); toast.success(result.allCompleted ? "Expedição concluída" : "Produtos conferidos; há itens pendentes"); onRefresh(); onClose();
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : (failure as { message?: string })?.message || "Erro ao concluir"); onRefresh(); onClose(); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4" aria-label="Conferência do pedido">
    <div className="flex items-center justify-between gap-2"><div className="min-w-0"><h2 className="break-words text-lg font-bold">{order.customer_name || "Cliente"}</h2><p className="text-xs text-muted-foreground">Pedido {order.id.slice(0, 8).toUpperCase()}</p></div><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Voltar à fila" onClick={onClose}><X className="h-5 w-5" /></Button></div>
    <div className="flex items-center justify-between"><span className="text-3xl font-bold" aria-live="polite">{scanned} de {quantity}</span><Badge variant="outline">Conferência</Badge></div>
    {!outbox.online && <p className="flex items-center gap-2 text-sm text-destructive"><WifiOff className="h-5 w-5" />Sem internet · bipes guardados no aparelho</p>}
    {(outbox.pending > 0 || outbox.error) && <div className="space-y-2 border-l-4 border-primary pl-3"><p className="text-sm">{outbox.pending} bipe(s) pendente(s)</p>{outbox.error && <p role="alert" className="break-words text-sm text-destructive">{outbox.error}</p>}<Button variant="outline" className="h-11 w-full" disabled={!outbox.online || outbox.syncing} onClick={() => void outbox.sync()}><RefreshCw className={`mr-2 h-4 w-4 ${outbox.syncing ? "animate-spin" : ""}`} />Sincronizar</Button></div>}
    {outbox.stale && <p role="alert" className="text-sm text-destructive">O pedido mudou. Volte à fila para conferir a etapa atual; os bipes anteriores continuam guardados.</p>}
    {featured && <div className="flex items-center gap-3"><ItemPhotoThumb photo={photos.get(itemPhotoKey(featured))} size={112} medium alt={featured.product_name || "Item"} /><div className="min-w-0"><p className="break-words font-semibold">{featured.product_name}</p><p className="break-words text-sm text-muted-foreground">{featured.variant_name} · {featured.size}</p></div></div>}
    {camera && <MobilePdvCamera onScan={raw => void scan(raw)} onClose={() => setCamera(false)} />}
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void scan(code); }}><Input ref={input} aria-label="Código do produto" value={code} onChange={event => setCode(event.target.value)} onBlur={() => { if (!camera) input.current?.focus(); }} placeholder="Código de barras, etiqueta ou SKU" className="h-12 min-w-0" autoComplete="off" /><Button type="submit" size="icon" className="h-12 w-12 shrink-0" aria-label="Bipar"><ScanBarcode className="h-5 w-5" /></Button></form>
    <div className="flex gap-2"><Button variant="outline" className="h-12 flex-1" onClick={() => setCamera(value => !value)}><Camera className="mr-2 h-5 w-5" />Câmera</Button><Button variant="outline" className="h-12 flex-1" disabled={scanned === 0 && !outbox.pending} onClick={() => { outbox.undo(); setMessage("Último bipe desfeito"); input.current?.focus(); }}><Undo2 className="mr-2 h-5 w-5" />Desfazer</Button></div>
    {message && <p role="status" className="break-words border-l-4 border-primary pl-3 text-sm font-semibold">{message}</p>}
    <ul className="divide-y">{order.items.map(item => <li key={item.id} className="space-y-2 py-3"><div className="flex items-start justify-between gap-2"><p className="min-w-0 break-words font-medium">{item.product_name} · {item.size}</p><span className="shrink-0 text-sm font-bold">{outbox.totals[item.id] || 0}/{item.quantity}</span></div><label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={!!checks[item.id]?.feet_ok} onCheckedChange={checked => setChecks(current => ({ ...current, [item.id]: { has_defect: current[item.id]?.has_defect || false, feet_ok: checked === true } }))} />Pés e numeração conferidos</label><label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={!!checks[item.id]?.has_defect} onCheckedChange={checked => setChecks(current => ({ ...current, [item.id]: { feet_ok: current[item.id]?.feet_ok || false, has_defect: checked === true } }))} />Tem defeito</label></li>)}</ul>
    {missingShipping && <><p role="alert" className="text-sm text-destructive">{missingShipping}. Complete na versão completa.</p><FullExpedition label="Conferir dados de envio" /></>}
    <Button className="h-12 w-full text-base" disabled={!complete || outbox.pending > 0 || outbox.stale || outbox.invalid || !!missingShipping || busy || !outbox.online} onClick={() => void conclude()}>{busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}Concluir conferência e despacho</Button>
    {outbox.stale && outbox.pending === 0 && <Button variant="outline" className="h-12 w-full" onClick={() => { outbox.reset(); onClose(); }}>Recomeçar com o pedido atualizado</Button>}
  </section>;
}

export function MobileExpedition({ storeId }: { storeId: string }) {
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<ExpStage>("novo");
  const [search, setSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ExpOrder | null>(null);
  const [busyId, setBusyId] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setServerSearch(search.trim()); setOffset(0); }, 400); return () => clearTimeout(timer); }, [search]);
  const key = ["mobile-pdv-expedition", storeId, stage, serverSearch, offset];
  const orders = useQuery({ queryKey: key, queryFn: () => fetchExpeditionOrders(storeId, stage, undefined, "all", serverSearch, { limit: 50, offset }) });
  const counts = useQuery({ queryKey: ["pos-expedition-counts", storeId], queryFn: async () => {
    const { data, error } = await supabase.rpc("pos_expedition_stage_counts", { p_store_id: storeId }); if (error) throw error;
    return Object.fromEntries((data || []).map(row => [row.stage, Number(row.total)]));
  } });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["mobile-pdv-expedition", storeId] }); void queryClient.invalidateQueries({ queryKey: ["pos-expedition-counts", storeId] }); };
  usePdvStoreEvents(storeId, "sales_changed", refresh);
  const photos = useItemPhotos((orders.data || []).flatMap(order => order.items.map(itemPhotoKey)));
  const move = async (order: ExpOrder) => {
    const to = nextStage(stage); if (!to) return;
    setBusyId(order.id);
    try { await moveExpeditionOrders([order], to, stage === "separacao" ? "items" : stage === "aguardando" ? "waiting" : "advance"); toast.success("Pedido avançado"); }
    catch (failure) { toast.error((failure as { message?: string })?.message || "Erro ao avançar"); }
    finally { setBusyId(""); refresh(); }
  };
  if (selected && userId) return <MobileConference key={`${selected.id}:${selected.updated_at || selected.expedition_stage}`} order={selected} userId={userId} onClose={() => setSelected(null)} onRefresh={refresh} />;
  return <div className="space-y-3">
    <div className="flex gap-2"><Input aria-label="Buscar pedido" placeholder="Nome ou número do pedido" className="h-12 min-w-0" value={search} onChange={event => setSearch(event.target.value)} /><Button variant="outline" size="icon" className="h-12 w-12 shrink-0" aria-label="Atualizar fila" onClick={refresh}><RefreshCw className="h-5 w-5" /></Button></div>
    <Select value={stage} onValueChange={(value: ExpStage) => { setStage(value); setOffset(0); }}><SelectTrigger aria-label="Etapa da expedição" className="h-12"><SelectValue /></SelectTrigger><SelectContent>{EXP_STAGES.map(item => <SelectItem key={item.id} value={item.id} className="min-h-11">{item.label} ({counts.data?.[item.id] || 0})</SelectItem>)}</SelectContent></Select>
    {orders.isPending && <Loader2 className="mx-auto h-8 w-8 animate-spin" />}
    {(orders.isError || counts.isError) && <p role="alert" className="text-sm text-destructive">Não consegui carregar a fila. Tente atualizar.</p>}
    {orders.data?.length === 0 && <div className="py-10 text-center text-muted-foreground"><Package className="mx-auto mb-2 h-10 w-10" /><p>Nenhum pedido nesta etapa</p></div>}
    <ul className="space-y-3">{(orders.data || []).map(order => <li key={order.id} className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2"><h2 className="min-w-0 break-words font-bold">{order.customer_name || "Cliente"}</h2>{isSedexOrder(order) && <Badge className="shrink-0">SEDEX</Badge>}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{EXP_STAGES.find(item => item.id === stage)?.label}</span><span>#{order.id.slice(0, 8).toUpperCase()}</span><span>{new Date(order.created_at).toLocaleDateString("pt-BR")}</span></div>
      <ul className="space-y-2">{order.items.map(item => <li key={item.id} className="flex items-center gap-3"><ItemPhotoThumb photo={photos.get(itemPhotoKey(item))} size={56} alt={item.product_name || "Item"} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{item.product_name}</p><p className="break-words text-xs text-muted-foreground">{item.variant_name} · {item.size} · {item.quantity} par(es)</p></div></li>)}</ul>
      {order.is_avulso && !order.avulso_ready ? <FullExpedition label="Completar pedido avulso" /> : stage === "conferencia" ? <Button className="h-12 w-full" disabled={!userId} onClick={() => setSelected(order)}><ScanBarcode className="mr-2 h-5 w-5" />Conferir pedido</Button> : nextStage(stage) ? <Button className="h-12 w-full" disabled={busyId === order.id} onClick={() => void move(order)}>{busyId === order.id ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ChevronRight className="mr-2 h-5 w-5" />}Avançar para {EXP_STAGES.find(item => item.id === nextStage(stage))?.label}</Button> : null}
    </li>)}</ul>
    <div className="flex items-center justify-between gap-2"><Button variant="outline" className="h-12" disabled={offset === 0 || orders.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}><ChevronLeft className="mr-1 h-4 w-4" />Anterior</Button><span className="text-xs text-muted-foreground">Página {offset / 50 + 1}</span><Button variant="outline" className="h-12" disabled={(orders.data?.length || 0) < 50 || orders.isFetching} onClick={() => setOffset(offset + 50)}>Próxima<ChevronRight className="ml-1 h-4 w-4" /></Button></div>
    <FullExpedition label="Editar, frete, etiquetas e outras ações" />
  </div>;
}