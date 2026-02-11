import { useState, useEffect } from "react";
import {
  ArrowRightLeft, Plus, Search, Package, Check, X, Loader2,
  Clock, Truck, AlertCircle, Send, Bell, Phone
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  storeId: string;
}

interface RequestItem {
  product_name: string;
  sku: string;
  quantity: number;
  size: string;
  color: string;
}

interface StoreRequest {
  id: string;
  from_store_id: string;
  to_store_id: string;
  status: string;
  items: RequestItem[];
  customer_name: string | null;
  customer_phone: string | null;
  courier_name: string | null;
  courier_phone: string | null;
  estimated_arrival: string | null;
  notes: string | null;
  priority: string;
  created_at: string;
  requested_by: string | null;
  responded_by: string | null;
}

interface Store {
  id: string;
  name: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: "Aguardando", color: "bg-yellow-500/20 text-yellow-400", icon: Clock },
  confirmed: { label: "Confirmado", color: "bg-blue-500/20 text-blue-400", icon: Check },
  in_transit: { label: "A Caminho", color: "bg-purple-500/20 text-purple-400", icon: Truck },
  delivered: { label: "Entregue", color: "bg-green-500/20 text-green-400", icon: Check },
  cancelled: { label: "Cancelado", color: "bg-red-500/20 text-red-400", icon: X },
  unavailable: { label: "Indisponível", color: "bg-gray-500/20 text-gray-400", icon: AlertCircle },
};

export function POSInterStoreRequests({ storeId }: Props) {
  const [requests, setRequests] = useState<StoreRequest[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [tab, setTab] = useState<"sent" | "received">("received");

  // Form
  const [targetStoreId, setTargetStoreId] = useState("");
  const [items, setItems] = useState<RequestItem[]>([{ product_name: "", sku: "", quantity: 1, size: "", color: "" }]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [priority, setPriority] = useState("normal");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Response form
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseStatus, setResponseStatus] = useState("confirmed");
  const [courierName, setCourierName] = useState("");
  const [courierPhone, setCourierPhone] = useState("");
  const [estimatedArrival, setEstimatedArrival] = useState("");
  const [responseNotes, setResponseNotes] = useState("");

  useEffect(() => {
    loadData();

    // Realtime subscription for new requests
    const channel = supabase
      .channel("pos-requests-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_inter_store_requests" }, () => {
        loadRequests();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [storeId]);

  const loadData = async () => {
    await Promise.all([loadRequests(), loadStores(), loadSellers()]);
  };

  const loadRequests = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("pos_inter_store_requests")
      .select("*")
      .or(`from_store_id.eq.${storeId},to_store_id.eq.${storeId}`)
      .order("created_at", { ascending: false });
    setRequests((data as any[]) || []);
    setLoading(false);
  };

  const loadStores = async () => {
    const { data } = await supabase.from("pos_stores").select("id, name");
    setStores(data || []);
  };

  const loadSellers = async () => {
    const { data } = await supabase.from("pos_sellers").select("id, name").eq("store_id", storeId).eq("is_active", true);
    setSellers(data || []);
  };

  const otherStores = stores.filter(s => s.id !== storeId);
  const storeName = (id: string) => stores.find(s => s.id === id)?.name || "Loja";

  const sentRequests = requests.filter(r => r.from_store_id === storeId);
  const receivedRequests = requests.filter(r => r.to_store_id === storeId);
  const displayedRequests = tab === "sent" ? sentRequests : receivedRequests;

  const pendingReceivedCount = receivedRequests.filter(r => r.status === "pending").length;

  const handleCreate = async () => {
    if (!targetStoreId) { toast.error("Selecione a loja de destino"); return; }
    if (items.every(i => !i.product_name.trim())) { toast.error("Adicione ao menos um produto"); return; }

    setSaving(true);
    try {
      const { error } = await supabase.from("pos_inter_store_requests").insert({
        from_store_id: storeId,
        to_store_id: targetStoreId,
        items: items.filter(i => i.product_name.trim()),
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        priority,
        notes: formNotes || null,
      } as any);

      if (error) throw error;
      toast.success("Solicitação enviada!");
      setShowNew(false);
      resetForm();
      loadRequests();
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRespond = async (id: string) => {
    try {
      const update: any = {
        status: responseStatus,
        notes: responseNotes || null,
      };
      if (responseStatus === "confirmed" || responseStatus === "in_transit") {
        update.courier_name = courierName || null;
        update.courier_phone = courierPhone || null;
        update.estimated_arrival = estimatedArrival || null;
      }
      if (responseStatus === "delivered") {
        update.delivered_at = new Date().toISOString();
      }

      const { error } = await supabase.from("pos_inter_store_requests").update(update).eq("id", id);
      if (error) throw error;
      toast.success("Status atualizado!");
      setRespondingId(null);
      resetResponseForm();
      loadRequests();
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    }
  };

  const resetForm = () => {
    setTargetStoreId("");
    setItems([{ product_name: "", sku: "", quantity: 1, size: "", color: "" }]);
    setCustomerName("");
    setCustomerPhone("");
    setPriority("normal");
    setFormNotes("");
  };

  const resetResponseForm = () => {
    setResponseStatus("confirmed");
    setCourierName("");
    setCourierPhone("");
    setEstimatedArrival("");
    setResponseNotes("");
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-pos-white flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-pos-orange" /> Solicitações entre Lojas
          </h2>
          <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> Nova Solicitação
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button onClick={() => setTab("received")} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${tab === "received" ? "bg-pos-orange text-pos-white" : "bg-pos-white/5 text-pos-white/50"}`}>
            📥 Recebidas {pendingReceivedCount > 0 && <Badge className="ml-1 bg-red-500 text-white border-0 text-[10px]">{pendingReceivedCount}</Badge>}
          </button>
          <button onClick={() => setTab("sent")} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${tab === "sent" ? "bg-pos-orange text-pos-black" : "bg-pos-white/5 text-pos-white/50"}`}>
            📤 Enviadas ({sentRequests.length})
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-pos-orange" /></div>
        ) : displayedRequests.length === 0 ? (
          <div className="text-center py-12 text-pos-white/40">
            <ArrowRightLeft className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p>Nenhuma solicitação {tab === "sent" ? "enviada" : "recebida"}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayedRequests.map(req => {
              const statusInfo = STATUS_MAP[req.status] || STATUS_MAP.pending;
              const StatusIcon = statusInfo.icon;
              const isSent = req.from_store_id === storeId;
              return (
                <Card key={req.id} className={`border-pos-orange/10 ${req.status === "pending" && !isSent ? "bg-pos-orange/10 border-pos-orange/30" : "bg-pos-white/5"}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {req.priority === "urgent" && <Badge className="bg-red-500 text-white border-0 text-[10px]">URGENTE</Badge>}
                        <Badge className={`text-[10px] ${statusInfo.color} border-0`}>
                          <StatusIcon className="h-3 w-3 mr-1" />{statusInfo.label}
                        </Badge>
                        <span className="text-xs text-pos-white/60">
                          {isSent ? `→ ${storeName(req.to_store_id)}` : `← ${storeName(req.from_store_id)}`}
                        </span>
                      </div>
                      <span className="text-[10px] text-pos-white/40">{new Date(req.created_at).toLocaleString("pt-BR")}</span>
                    </div>

                    {/* Items */}
                    <div className="space-y-1 mb-2">
                      {(req.items || []).map((it, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-pos-white">
                          <Package className="h-3 w-3 text-pos-orange" />
                          <span>{it.quantity}x {it.product_name}</span>
                          {it.size && <Badge variant="outline" className="text-[10px] border-pos-white/20 text-pos-white/60">{it.size}</Badge>}
                          {it.color && <Badge variant="outline" className="text-[10px] border-pos-white/20 text-pos-white/60">{it.color}</Badge>}
                        </div>
                      ))}
                    </div>

                    {req.customer_name && <p className="text-xs text-pos-white/50">👤 Cliente: {req.customer_name} {req.customer_phone && `(${req.customer_phone})`}</p>}
                    {req.courier_name && <p className="text-xs text-pos-white/50">🏍️ Motoboy: {req.courier_name} {req.courier_phone && `(${req.courier_phone})`}</p>}
                    {req.estimated_arrival && <p className="text-xs text-pos-white/50">⏰ Previsão: {req.estimated_arrival}</p>}
                    {req.notes && <p className="text-[10px] text-pos-white/40 mt-1">📝 {req.notes}</p>}

                    {/* Actions */}
                    {!isSent && req.status === "pending" && (
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" className="bg-green-600 text-white hover:bg-green-700 gap-1 text-xs" onClick={() => { setRespondingId(req.id); setResponseStatus("confirmed"); }}>
                          <Check className="h-3 w-3" /> Confirmar
                        </Button>
                        <Button size="sm" variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/10 gap-1 text-xs" onClick={() => { setRespondingId(req.id); setResponseStatus("unavailable"); }}>
                          <X className="h-3 w-3" /> Indisponível
                        </Button>
                      </div>
                    )}
                    {!isSent && req.status === "confirmed" && (
                      <Button size="sm" className="mt-3 bg-purple-600 text-white hover:bg-purple-700 gap-1 text-xs" onClick={() => { setRespondingId(req.id); setResponseStatus("in_transit"); }}>
                        <Truck className="h-3 w-3" /> Enviar c/ Motoboy
                      </Button>
                    )}
                    {isSent && req.status === "in_transit" && (
                      <Button size="sm" className="mt-3 bg-green-600 text-white hover:bg-green-700 gap-1 text-xs" onClick={() => handleRespond(req.id)}>
                        <Check className="h-3 w-3" /> Confirmar Recebimento
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* New Request Dialog */}
        <Dialog open={showNew} onOpenChange={v => { if (!v) resetForm(); setShowNew(v); }}>
          <DialogContent className="bg-pos-black border-pos-orange/30 max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-pos-white flex items-center gap-2">
                <Send className="h-5 w-5 text-pos-orange" /> Solicitar Produto
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Target store */}
              <div>
                <Label className="text-pos-white/60 text-xs">Pedir para qual loja?</Label>
                <Select value={targetStoreId} onValueChange={setTargetStoreId}>
                  <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white">
                    <SelectValue placeholder="Selecione a loja" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherStores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="flex gap-2">
                <button onClick={() => setPriority("normal")} className={`flex-1 py-2 rounded-lg text-xs font-bold ${priority === "normal" ? "bg-pos-orange text-pos-black" : "bg-pos-white/5 text-pos-white/50"}`}>
                  Normal
                </button>
                <button onClick={() => setPriority("urgent")} className={`flex-1 py-2 rounded-lg text-xs font-bold ${priority === "urgent" ? "bg-red-500 text-white" : "bg-pos-white/5 text-pos-white/50"}`}>
                  🚨 Urgente
                </button>
              </div>

              <Separator className="bg-pos-white/10" />

              {/* Items */}
              <div className="space-y-2">
                {items.map((_, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_60px_60px_60px_32px] gap-2 items-end">
                    <div>
                      <Label className="text-pos-white/50 text-[10px]">Produto</Label>
                      <Input value={items[idx].product_name} onChange={e => setItems(p => p.map((it, i) => i === idx ? { ...it, product_name: e.target.value } : it))} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
                    </div>
                    <div>
                      <Label className="text-pos-white/50 text-[10px]">Tam</Label>
                      <Input value={items[idx].size} onChange={e => setItems(p => p.map((it, i) => i === idx ? { ...it, size: e.target.value } : it))} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
                    </div>
                    <div>
                      <Label className="text-pos-white/50 text-[10px]">Cor</Label>
                      <Input value={items[idx].color} onChange={e => setItems(p => p.map((it, i) => i === idx ? { ...it, color: e.target.value } : it))} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
                    </div>
                    <div>
                      <Label className="text-pos-white/50 text-[10px]">Qtd</Label>
                      <Input type="number" value={items[idx].quantity} onChange={e => setItems(p => p.map((it, i) => i === idx ? { ...it, quantity: parseInt(e.target.value) || 1 } : it))} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400" onClick={() => setItems(p => p.filter((_, i) => i !== idx))} disabled={items.length <= 1}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button variant="ghost" className="text-pos-orange text-xs gap-1" onClick={() => setItems(p => [...p, { product_name: "", sku: "", quantity: 1, size: "", color: "" }])}>
                  <Plus className="h-3 w-3" /> Adicionar Produto
                </Button>
              </div>

              <Separator className="bg-pos-white/10" />

              {/* Customer */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-pos-white/50 text-xs">Nome do cliente</Label>
                  <Input value={customerName} onChange={e => setCustomerName(e.target.value)} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" placeholder="Opcional" />
                </div>
                <div>
                  <Label className="text-pos-white/50 text-xs">WhatsApp do cliente</Label>
                  <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" placeholder="Opcional" />
                </div>
              </div>

              <div>
                <Label className="text-pos-white/50 text-xs">Observações</Label>
                <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} className="h-16 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white resize-none" />
              </div>

              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-12 gap-2" onClick={handleCreate} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar Solicitação
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Respond Dialog */}
        <Dialog open={!!respondingId} onOpenChange={v => { if (!v) { setRespondingId(null); resetResponseForm(); } }}>
          <DialogContent className="bg-pos-black border-pos-orange/30 max-w-md">
            <DialogHeader>
              <DialogTitle className="text-pos-white">Responder Solicitação</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Select value={responseStatus} onValueChange={setResponseStatus}>
                <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">✅ Confirmado - Temos o produto</SelectItem>
                  <SelectItem value="in_transit">🏍️ A caminho - Enviando com motoboy</SelectItem>
                  <SelectItem value="unavailable">❌ Indisponível</SelectItem>
                  <SelectItem value="cancelled">🚫 Cancelar</SelectItem>
                </SelectContent>
              </Select>

              {(responseStatus === "confirmed" || responseStatus === "in_transit") && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-pos-white/50 text-xs">Nome do motoboy</Label>
                      <Input value={courierName} onChange={e => setCourierName(e.target.value)} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
                    </div>
                    <div>
                      <Label className="text-pos-white/50 text-xs">Telefone do motoboy</Label>
                      <Input value={courierPhone} onChange={e => setCourierPhone(e.target.value)} className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-pos-white/50 text-xs">Previsão de chegada</Label>
                    <Input value={estimatedArrival} onChange={e => setEstimatedArrival(e.target.value)} placeholder="Ex: 30 minutos" className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white" />
                  </div>
                </>
              )}

              <div>
                <Label className="text-pos-white/50 text-xs">Observação</Label>
                <Textarea value={responseNotes} onChange={e => setResponseNotes(e.target.value)} className="h-16 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white resize-none" />
              </div>

              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={() => respondingId && handleRespond(respondingId)}>
                Confirmar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}
