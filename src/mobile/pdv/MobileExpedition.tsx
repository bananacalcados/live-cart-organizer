import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ListChecks, Pencil, SlidersHorizontal, Camera, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Monitor, Package, RefreshCw, ScanBarcode, Undo2, WifiOff, X } from "lucide-react";
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
import { brl, EXP_STAGES, fetchExpeditionOrders, nextStage, type ExpOrder, type ExpStage } from "@/lib/pos/expedition";
import { advanceMode, canBulkAdvance, originLabel, shippingMethodOf, shippingTag, sortMobileExpedition, type ShippingTone } from "@/lib/pos/expeditionReadiness";
import { mobileOrderAddress, mobileAddressLine, mobileMissingOrderData } from "./expeditionData";
import { buildExchangeLocks, type ExchangeLock } from "@/lib/pos/exchangeReplacementLock";
import { ExpShippingFields, type ShippingFieldsValue } from "@/components/pos/expedition/ExpShippingFields";
import { ExpFreightQuotePanel } from "@/components/pos/expedition/ExpFreightQuotePanel";
import { MobileExpeditionDocuments } from "./MobileExpeditionDocuments";
import { isCarrierWithTracking, isMototaxi, isPickup } from "@/lib/pos/expedition";
import "./expedition.css";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ExpOrderEditDialog } from "@/components/pos/expedition/ExpOrderEditDialog";
import { expeditionShippingError, finishExpedition, moveExpeditionOrders, type ExpeditionShipping } from "@/lib/pos/expeditionActions";
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

type MobileExpOrder = ExpOrder & { exchangeLock?: ExchangeLock };
function ExchangeBadge({ order }: { order: MobileExpOrder }) {
  return order.exchangeLock ? <Badge variant="destructive" className="h-auto whitespace-normal">TROCA {order.exchangeLock.code}{!order.exchangeLock.canConclude ? " — AGUARDANDO FINALIZAR A TROCA NO PDV" : ""}</Badge> : null;
}

function MobileConference({ order, userId, onClose, onRefresh }: { order: MobileExpOrder; userId: string; onClose: () => void; onRefresh: () => void }) {
  const outbox = useExpeditionOutbox(order, userId);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [lastItemId, setLastItemId] = useState(order.items[0]?.id || "");
  const [checks, setChecks] = useState<Record<string, { feet_ok: boolean; has_defect: boolean }>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const finishLock = useRef(false);
  const [editing, setEditing] = useState(false);
  const [shippingFields, setShippingFields] = useState<ShippingFieldsValue>({ carrier: order.shipping_carrier || order.delivery_method || "", courier: order.courier_name || "", courierProviderId: "", cost: order.shipping_cost == null ? "" : String(order.shipping_cost) });
  const [tracking, setTracking] = useState(order.tracking_code || "");
  const [trackingUrl, setTrackingUrl] = useState(order.tracking_url || "");
  const [deliveryDays, setDeliveryDays] = useState(order.delivery_days || "");
  const input = useRef<HTMLInputElement>(null);
  const photos = useItemPhotos(order.items.map(itemPhotoKey));
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const scanned = Object.values(outbox.totals).reduce((sum, total) => sum + total, 0);
  const featured = order.items.find(item => item.id === lastItemId) || order.items[0];
  const shipping: ExpeditionShipping = { carrier: shippingFields.carrier, tracking, trackingUrl, deliveryDays, courier: shippingFields.courier,
    courierProviderId: shippingFields.courierProviderId, cost: Number(shippingFields.cost), storeId: order.store_id };
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
    if (finishLock.current || !complete || outbox.pending || outbox.stale || outbox.invalid || !outbox.online || order.exchangeLock?.canConclude === false) return;
    finishLock.current = true;
    setBusy(true);
    try {
      const result = await finishExpedition(order, Object.fromEntries(order.items.map(item => [item.id, { scanned: true, feet_ok: !!checks[item.id]?.feet_ok, has_defect: !!checks[item.id]?.has_defect }])), shipping);
      outbox.reset(); toast.success(result.allCompleted ? "Expedição concluída" : "Produtos conferidos; há itens pendentes"); onRefresh(); onClose();
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : (failure as { message?: string })?.message || "Erro ao concluir"); onRefresh(); onClose(); }
    finally { finishLock.current = false; setBusy(false); }
  };
  return <section className="space-y-4" aria-label="Conferência do pedido">
    <div className="flex items-center justify-between gap-2"><div className="min-w-0"><h2 className="break-words text-lg font-bold">{order.customer_name || "Cliente"}</h2><p className="text-xs text-muted-foreground">Pedido {order.id.slice(0, 8).toUpperCase()}</p></div><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Voltar à fila" onClick={onClose}><X className="h-5 w-5" /></Button></div>
    <div className="flex items-center justify-between"><span className="text-3xl font-bold" aria-live="polite">{scanned} de {quantity}</span><Badge variant="outline">Conferência</Badge></div>
    <ExchangeBadge order={order} />
    {!outbox.online && <p className="flex items-center gap-2 text-sm text-destructive"><WifiOff className="h-5 w-5" />Sem internet · bipes guardados no aparelho</p>}
    {(outbox.pending > 0 || outbox.error) && <div className="space-y-2 border-l-4 border-primary pl-3"><p className="text-sm">{outbox.pending} bipe(s) pendente(s)</p>{outbox.error && <p role="alert" className="break-words text-sm text-destructive">{outbox.error}</p>}<Button variant="outline" className="h-11 w-full" disabled={!outbox.online || outbox.syncing} onClick={() => void outbox.sync()}><RefreshCw className={`mr-2 h-4 w-4 ${outbox.syncing ? "animate-spin" : ""}`} />Sincronizar</Button></div>}
    {outbox.stale && <p role="alert" className="text-sm text-destructive">O pedido mudou. Volte à fila para conferir a etapa atual; os bipes anteriores continuam guardados.</p>}
    {featured && <div className="flex items-center gap-3"><ItemPhotoThumb photo={photos.get(itemPhotoKey(featured))} size={112} medium alt={featured.product_name || "Item"} /><div className="min-w-0"><p className="break-words font-semibold">{featured.product_name}</p><p className="break-words text-sm text-muted-foreground">{featured.variant_name} · {featured.size}</p></div></div>}
    {camera && <MobilePdvCamera onScan={raw => void scan(raw)} onClose={() => setCamera(false)} />}
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void scan(code); }}><Input ref={input} aria-label="Código do produto" value={code} onChange={event => setCode(event.target.value)} placeholder="Código de barras, etiqueta ou SKU" className="h-12 min-w-0" autoComplete="off" /><Button type="submit" size="icon" className="h-12 w-12 shrink-0" aria-label="Bipar"><ScanBarcode className="h-5 w-5" /></Button></form>
    <div className="flex gap-2"><Button variant="outline" className="h-12 flex-1" onClick={() => setCamera(value => !value)}><Camera className="mr-2 h-5 w-5" />Câmera</Button><Button variant="outline" className="h-12 flex-1" disabled={scanned === 0 && !outbox.pending} onClick={() => { outbox.undo(); setMessage("Último bipe desfeito"); input.current?.focus(); }}><Undo2 className="mr-2 h-5 w-5" />Desfazer</Button></div>
    {message && <p role="status" className="break-words border-l-4 border-primary pl-3 text-sm font-semibold">{message}</p>}
    <ul className="divide-y">{order.items.map(item => <li key={item.id} className="space-y-2 py-3"><div className="flex items-start justify-between gap-2"><p className="min-w-0 break-words font-medium">{item.product_name} · {item.size}</p><span className="shrink-0 text-sm font-bold">{outbox.totals[item.id] || 0}/{item.quantity}</span></div><label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={!!checks[item.id]?.feet_ok} onCheckedChange={checked => setChecks(current => ({ ...current, [item.id]: { has_defect: current[item.id]?.has_defect || false, feet_ok: checked === true } }))} />Pés e numeração conferidos</label><label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={!!checks[item.id]?.has_defect} onCheckedChange={checked => setChecks(current => ({ ...current, [item.id]: { feet_ok: current[item.id]?.feet_ok || false, has_defect: checked === true } }))} />Tem defeito</label></li>)}</ul>
    <section className="space-y-3 border-t pt-4" aria-label="Dados e forma de envio"><h3 className="font-bold">Dados e forma de envio</h3><p className="break-words text-sm">{mobileAddressLine(order) || "Endereço não informado"}</p><Button variant="outline" className="h-12 w-full" onClick={() => setEditing(true)}><Pencil className="mr-2 h-5 w-5" />Conferir/corrigir dados do pedido</Button>
      <ExpShippingFields value={shippingFields} onChange={setShippingFields} />
      {!order.is_store_pickup && !isMototaxi(shippingFields.carrier) && !isPickup(shippingFields.carrier) && <ExpFreightQuotePanel saleId={order.id} open onSelected={option => { setShippingFields(current => ({ ...current, carrier: option.shipping_carrier, cost: String(option.price), courier: "", courierProviderId: "" })); setDeliveryDays(option.delivery_days == null ? "" : String(option.delivery_days)); }} />}
      {isCarrierWithTracking(shippingFields.carrier) && <><label className="block space-y-1 text-sm font-medium">Código de rastreio<Input aria-label="Código de rastreio" value={tracking} onChange={e => setTracking(e.target.value)} className="h-12" /></label><label className="block space-y-1 text-sm font-medium">Prazo de entrega (dias úteis)<Input value={deliveryDays} onChange={e => setDeliveryDays(e.target.value)} className="h-12" /></label><label className="block space-y-1 text-sm font-medium">Link de rastreio<Input value={trackingUrl} onChange={e => setTrackingUrl(e.target.value)} className="h-12" /></label></>}
    </section>
    <MobileExpeditionDocuments order={{ ...order, shipping_address: { ...order.shipping_address, ...mobileOrderAddress(order) } }} allowEmission />
    {missingShipping && <p role="alert" className="text-sm text-destructive">{missingShipping}</p>}
    {editing && <ExpOrderEditDialog order={{ ...order, shipping_address: { ...order.shipping_address, ...mobileOrderAddress(order) } }} storeId={order.store_id} open onOpenChange={setEditing} onSaved={() => { setEditing(false); onRefresh(); }} />}
    <Button className="h-12 w-full text-base" disabled={!complete || outbox.pending > 0 || outbox.stale || outbox.invalid || !!missingShipping || busy || !outbox.online || order.exchangeLock?.canConclude === false} onClick={() => void conclude()}>{busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}Concluir conferência e despacho</Button>
    {outbox.stale && outbox.pending === 0 && <Button variant="outline" className="h-12 w-full" onClick={() => { outbox.reset(); onClose(); }}>Recomeçar com o pedido atualizado</Button>}
  </section>;
}

function StoreEvents({ storeId, refresh }: { storeId: string; refresh: () => void }) { usePdvStoreEvents(storeId, "sales_changed", refresh); return null; }

const TONE: Record<ShippingTone, string> = {
  sedex: "bg-amber-500 text-white", moto: "bg-violet-600 text-white", pickup: "bg-sky-600 text-white",
  carrier: "bg-slate-700 text-white", none: "border border-dashed text-muted-foreground",
};
const SHIPPING_FILTERS = [["all", "Todas as formas"], ["moto", "Mototaxista"], ["carrier", "Correios/transportadora"], ["pickup", "Retirada"], ["none", "Sem frete"]] as const;
const ORIGIN_FILTERS = [["all", "Todas as origens"], ["live", "Live"], ["whatsapp", "WhatsApp"], ["online", "Online/Site"]] as const;

function ShippingBadge({ order }: { order: ExpOrder }) {
  const tag = shippingTag(order);
  return <span className={`inline-flex min-h-7 items-center rounded-full px-3 text-xs font-bold ${TONE[tag.tone]}`}>{tag.label}</span>;
}
function DataStatus({ order }: { order: ExpOrder }) {
  const missing = mobileMissingOrderData(order);
  return missing.length ? <p className="flex items-center gap-1 text-xs font-semibold text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />Faltando: {missing.join(", ")}</p>
    : <p className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4 shrink-0" />Dados completos</p>;
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return <div className="flex justify-between gap-3 py-2 text-sm"><span className="text-muted-foreground">{label}</span><span className="min-w-0 break-words text-right font-medium">{value || "—"}</span></div>;
}

function MobileOrderDetail({ order, onClose, onSaved, onConference }: { order: MobileExpOrder; onClose: () => void; onSaved: () => void; onConference?: () => void }) {
  const [editing, setEditing] = useState(false);
  const a = mobileOrderAddress(order);
  const photos = useItemPhotos(order.items.map(itemPhotoKey));
  return <section className="space-y-3" aria-label="Detalhe do pedido">
    <div className="flex items-center gap-2"><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Voltar à lista" onClick={onClose}><ArrowLeft className="h-5 w-5" /></Button><div className="min-w-0 flex-1"><h2 className="break-words text-lg font-bold">{order.customer_name || "Cliente"}</h2><p className="text-xs text-muted-foreground">#{order.id.slice(0, 8).toUpperCase()} · {order.store_name || "Loja"}</p></div></div>
    <div className="flex flex-wrap items-center gap-2"><ShippingBadge order={order} /><Badge variant="outline">{originLabel(order)}</Badge></div>
    <ExchangeBadge order={order} />
    <DataStatus order={order} />
    <div className="divide-y rounded-lg border px-3">
      <Row label="Telefone" value={order.resolved_phone || order.customer_phone} /><Row label="CPF" value={order.customer_cpf} /><Row label="E-mail" value={order.customer_email} />
      <Row label="Endereço" value={[a.address, a.number, a.complement, a.neighborhood].filter(Boolean).join(", ")} /><Row label="Cidade" value={[a.city, a.state].filter(Boolean).join("/")} /><Row label="CEP" value={a.cep} />
      <Row label="Frete" value={shippingMethodOf(order)} /><Row label="Valor do frete" value={order.shipping_cost == null ? null : brl(order.shipping_cost)} /><Row label="Entregador" value={order.courier_name} /><Row label="Rastreio" value={order.tracking_code} />
      <Row label="Pagamento" value={[order.payment_method, order.payment_gateway].filter(Boolean).join(" · ")} /><Row label="Total" value={brl(order.total)} />
      <Row label="Vendedor(a)" value={order.seller_label} /><Row label="Live" value={order.event_name} /><Row label="Observações" value={order.shipping_notes || order.notes} />
    </div>
    <ul className="space-y-2">{order.items.map(item => <li key={item.id} className="flex items-center gap-3"><ItemPhotoThumb photo={photos.get(itemPhotoKey(item))} size={56} alt={item.product_name || "Item"} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{item.product_name}</p><p className="text-xs text-muted-foreground">{item.variant_name} · {item.size} · {item.quantity} par(es)</p></div></li>)}</ul>
    <Button className="h-12 w-full" onClick={() => setEditing(true)}><Pencil className="mr-2 h-5 w-5" />Editar dados do pedido</Button>
    {onConference && <Button variant="outline" className="h-12 w-full" onClick={onConference}><ScanBarcode className="mr-2 h-5 w-5" />Conferir pedido</Button>}
    <MobileExpeditionDocuments order={order} />
    {editing && <ExpOrderEditDialog order={{ ...order, shipping_address: { ...order.shipping_address, ...a } }} storeId={order.store_id} open={editing} onOpenChange={value => !value && setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />}
  </section>;
}

export function MobileExpedition({ storeId: _userStore }: { storeId: string }) {
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<ExpStage>("novo");
  const [store, setStore] = useState("all");
  const [shipping, setShipping] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [conference, setConference] = useState<MobileExpOrder | null>(null);
  const [detailId, setDetailId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ ok: number; failed: { name: string; reason: string }[] } | null>(null);
  useEffect(() => { const timer = setTimeout(() => { setServerSearch(search.trim()); setOffset(0); }, 400); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setPicked(new Set()); }, [stage, store, shipping, origin, serverSearch, offset]);
  const stores = useQuery({ queryKey: ["mobile-pdv-stores"], staleTime: 600_000, queryFn: async () => {
    const { data, error } = await supabase.from("pos_stores").select("id,name").eq("is_active", true).eq("is_simulation", false).order("name"); if (error) throw error; return data || [];
  } });
  const orders = useQuery({ queryKey: ["mobile-pdv-expedition", store, stage, serverSearch, shipping, origin, offset],
    queryFn: async () => {
      const rows = sortMobileExpedition(await fetchExpeditionOrders(store, stage, undefined, "all", serverSearch, { limit: 50, offset, shipping, origin }), stage);
      if (!rows.length) return [] as MobileExpOrder[];
      const { data, error } = await supabase.from("trocas_devolucoes").select("pedido_novo_id,codigo_devolucao,status,modo_expedicao")
        .in("pedido_novo_id", rows.map(o => o.id)).not("status", "in", "(cancelada,concluida)");
      if (error) throw error;
      const locks = buildExchangeLocks(data || []);
      return rows.map(o => ({ ...o, exchangeLock: locks[o.id] }));
    } });
  const counts = useQuery({ queryKey: ["mobile-pdv-expedition-counts", store], queryFn: async () => {
    const { data, error } = await supabase.rpc("mobile_pdv_expedition_counts", { p_store_id: store === "all" ? null : store }); if (error) throw error;
    return Object.fromEntries((data || []).map(row => [row.stage, Number(row.total)]));
  } });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["mobile-pdv-expedition"] }); void queryClient.invalidateQueries({ queryKey: ["mobile-pdv-expedition-counts"] }); };
  const list = orders.data || [];
  const photos = useItemPhotos(list.flatMap(order => order.items.map(itemPhotoKey)));
  const eligible = list.filter(order => canBulkAdvance(order, stage));
  const to = nextStage(stage);
  const toLabel = EXP_STAGES.find(item => item.id === to)?.label;
  const activeFilters = (shipping !== "all" ? 1 : 0) + (origin !== "all" ? 1 : 0);
  const move = async (order: ExpOrder) => {
    if (!to) return;
    setBusyId(order.id);
    try { await moveExpeditionOrders([order], to, advanceMode(stage)); toast.success("Pedido avançado"); }
    catch (failure) { toast.error((failure as { message?: string })?.message || "Erro ao avançar"); }
    finally { setBusyId(""); refresh(); }
  };
  const bulkAdvance = async () => {
    if (!to) return;
    const chosen = eligible.filter(order => picked.has(order.id));
    setBulkBusy(true);
    const failed: { name: string; reason: string }[] = []; let ok = 0;
    // One transition per order: each keeps its own lock/validation, so a failure never hides behind a partial batch.
    for (const order of chosen) {
      try { await moveExpeditionOrders([order], to, advanceMode(stage)); ok += 1; }
      catch (failure) { failed.push({ name: order.customer_name || `#${order.id.slice(0, 8).toUpperCase()}`, reason: (failure as { message?: string })?.message || "Erro ao avançar" }); }
    }
    setBulkBusy(false); setPicked(new Set()); setSelecting(false); setBulkResult({ ok, failed }); refresh();
  };
  const detail = list.find(order => order.id === detailId);
  const storeEvents = (store === "all" ? (stores.data || []).map(item => item.id) : [store]).map(id => <StoreEvents key={id} storeId={id} refresh={refresh} />);
  const currentConference = conference ? list.find(o => o.id === conference.id) || conference : null;
  if (currentConference && userId) return <div className="mobile-expedition-workspace">{storeEvents}<MobileConference key={`${currentConference.id}:${currentConference.updated_at || currentConference.expedition_stage}`} order={currentConference} userId={userId} onClose={() => setConference(null)} onRefresh={refresh} /></div>;
  if (detail) return <div className="mobile-expedition-workspace">{storeEvents}<MobileOrderDetail order={detail} onClose={() => setDetailId("")} onSaved={refresh} onConference={stage === "conferencia" && userId ? () => { setDetailId(""); setConference(detail); } : undefined} /></div>;
  return <div className={`mobile-expedition-workspace space-y-3 ${selecting ? "pb-24" : ""}`}>
    {storeEvents}
    <div className="flex gap-2"><Input aria-label="Buscar pedido" placeholder="Nome ou número do pedido" className="h-12 min-w-0" value={search} onChange={event => setSearch(event.target.value)} /><Button variant="outline" size="icon" className="h-12 w-12 shrink-0" aria-label="Atualizar fila" onClick={refresh}><RefreshCw className="h-5 w-5" /></Button></div>
    <div className="flex gap-2">
      <Select value={store} onValueChange={value => { setStore(value); setOffset(0); }}><SelectTrigger aria-label="Loja" className="h-12 min-w-0 flex-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all" className="min-h-11">Todas as lojas</SelectItem>{(stores.data || []).map(item => <SelectItem key={item.id} value={item.id} className="min-h-11">{item.name}</SelectItem>)}</SelectContent></Select>
      <Button variant="outline" className="h-12 shrink-0" onClick={() => setFiltersOpen(true)}><SlidersHorizontal className="mr-2 h-5 w-5" />Filtros{activeFilters ? ` (${activeFilters})` : ""}</Button>
    </div>
    <Select value={stage} onValueChange={(value: ExpStage) => { setStage(value); setOffset(0); }}><SelectTrigger aria-label="Etapa da expedição" className="h-12"><SelectValue /></SelectTrigger><SelectContent>{EXP_STAGES.map(item => <SelectItem key={item.id} value={item.id} className="min-h-11">{item.label} ({counts.data?.[item.id] || 0})</SelectItem>)}</SelectContent></Select>
    {to && stage !== "conferencia" && stage !== "concluido" && <div className="flex gap-2">
      <Button variant={selecting ? "default" : "outline"} className="h-11 flex-1" onClick={() => { setSelecting(value => !value); setPicked(new Set()); }}><ListChecks className="mr-2 h-5 w-5" />{selecting ? "Sair da seleção" : "Selecionar vários"}</Button>
      {selecting && <Button variant="outline" className="h-11 flex-1" disabled={!eligible.length} onClick={() => setPicked(picked.size === eligible.length ? new Set() : new Set(eligible.map(order => order.id)))}>{picked.size === eligible.length && eligible.length ? "Desmarcar todos" : `Selecionar todos (${eligible.length})`}</Button>}
    </div>}
    {bulkResult && <div role="status" className="space-y-1 rounded-lg border p-3 text-sm"><div className="flex items-start justify-between gap-2"><p className="font-semibold">{bulkResult.ok} pedido(s) avançaram{bulkResult.failed.length ? ` · ${bulkResult.failed.length} não avançaram` : ""}</p><Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Fechar resultado" onClick={() => setBulkResult(null)}><X className="h-4 w-4" /></Button></div>{bulkResult.failed.map((item, index) => <p key={index} className="break-words text-destructive">{item.name}: {item.reason}</p>)}</div>}
    {orders.isPending && <Loader2 className="mx-auto h-8 w-8 animate-spin" />}
    {(orders.isError || counts.isError) && <p role="alert" className="text-sm text-destructive">Não consegui carregar a fila. Tente atualizar.</p>}
    {orders.data?.length === 0 && <div className="py-10 text-center text-muted-foreground"><Package className="mx-auto mb-2 h-10 w-10" /><p>Nenhum pedido nesta etapa</p></div>}
    <ul className="space-y-3">{list.map(order => { const canPick = canBulkAdvance(order, stage); return <li key={order.id} className={`space-y-3 rounded-lg border bg-card p-3 ${picked.has(order.id) ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-start gap-3">
        {selecting && <Checkbox className="mt-1 h-6 w-6" aria-label={`Selecionar ${order.customer_name || "pedido"}`} disabled={!canPick} checked={picked.has(order.id)} onCheckedChange={checked => setPicked(current => { const next = new Set(current); if (checked === true) next.add(order.id); else next.delete(order.id); return next; })} />}
        <button type="button" className="min-w-0 flex-1 space-y-2 text-left" onClick={() => selecting ? canPick && setPicked(current => { const next = new Set(current); if (next.has(order.id)) next.delete(order.id); else next.add(order.id); return next; }) : setDetailId(order.id)}>
          <div className="flex flex-wrap items-center gap-2"><ShippingBadge order={order} /><span className="text-xs font-medium text-muted-foreground">{order.store_name || "Loja"}</span></div>
          <h2 className="break-words font-bold">{order.customer_name || "Cliente"}</h2>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{originLabel(order)}</span>{order.seller_label && <span>Vend.: {order.seller_label}</span>}<span>#{order.id.slice(0, 8).toUpperCase()}</span><span>{new Date(order.created_at).toLocaleDateString("pt-BR")}</span></div>
          <DataStatus order={order} />
          <ExchangeBadge order={order} />
          {mobileAddressLine(order) && <p className="break-words text-xs text-muted-foreground">{mobileAddressLine(order)}</p>}
        </button>
      </div>
      <ul className="space-y-2">{order.items.map(item => <li key={item.id} className="flex items-center gap-3"><ItemPhotoThumb photo={photos.get(itemPhotoKey(item))} size={56} alt={item.product_name || "Item"} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{item.product_name}</p><p className="break-words text-xs text-muted-foreground">{item.variant_name} · {item.size} · {item.quantity} par(es)</p></div></li>)}</ul>
      {!selecting && (order.is_avulso && !order.avulso_ready ? <FullExpedition label="Completar pedido avulso" /> : stage === "conferencia" ? <Button className="h-12 w-full" disabled={!userId} onClick={() => setConference(order)}><ScanBarcode className="mr-2 h-5 w-5" />Conferir pedido</Button> : to ? <Button className="h-12 w-full" disabled={busyId === order.id} onClick={() => void move(order)}>{busyId === order.id ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ChevronRight className="mr-2 h-5 w-5" />}Avançar para {toLabel}</Button> : null)}
    </li>; })}</ul>
    <div className="flex items-center justify-between gap-2"><Button variant="outline" className="h-12" disabled={offset === 0 || orders.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}><ChevronLeft className="mr-1 h-4 w-4" />Anterior</Button><span className="text-xs text-muted-foreground">Página {offset / 50 + 1}</span><Button variant="outline" className="h-12" disabled={list.length < 50 || orders.isFetching} onClick={() => setOffset(offset + 50)}>Próxima<ChevronRight className="ml-1 h-4 w-4" /></Button></div>
    <FullExpedition label="Etiquetas e outras ações" />
    {selecting && <div className="fixed inset-x-0 bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-40 border-t bg-background p-3 shadow-lg"><Button className="h-12 w-full text-base" disabled={!picked.size || bulkBusy} onClick={() => void bulkAdvance()}>{bulkBusy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ChevronRight className="mr-2 h-5 w-5" />}Avançar {picked.size} pedido(s) para {toLabel}</Button></div>}
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}><SheetContent side="bottom" className="h-[100dvh] overflow-y-auto"><SheetHeader><SheetTitle>Filtros</SheetTitle></SheetHeader>
      <div className="mt-4 space-y-5">
        <fieldset className="space-y-2"><legend className="mb-2 font-semibold">Forma de envio</legend>{SHIPPING_FILTERS.map(([value, label]) => <Button key={value} variant={shipping === value ? "default" : "outline"} className="h-12 w-full justify-start" onClick={() => { setShipping(value); setOffset(0); }}>{label}</Button>)}</fieldset>
        <fieldset className="space-y-2"><legend className="mb-2 font-semibold">Origem</legend>{ORIGIN_FILTERS.map(([value, label]) => <Button key={value} variant={origin === value ? "default" : "outline"} className="h-12 w-full justify-start" onClick={() => { setOrigin(value); setOffset(0); }}>{label}</Button>)}</fieldset>
        <div className="flex gap-2"><Button variant="outline" className="h-12 flex-1" onClick={() => { setShipping("all"); setOrigin("all"); setOffset(0); }}>Limpar</Button><Button className="h-12 flex-1" onClick={() => setFiltersOpen(false)}>Ver pedidos</Button></div>
      </div>
    </SheetContent></Sheet>
  </div>;
}
