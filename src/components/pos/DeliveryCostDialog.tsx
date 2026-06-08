import { useState, useEffect } from "react";
import { Truck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  fetchProviders,
  createDeliveryCost,
  ServiceProvider,
  ProviderType,
  DeliverySource,
} from "@/lib/deliveryProviders";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: DeliverySource;
  storeId?: string | null;
  posSaleId?: string | null;
  expeditionOrderId?: string | null;
  customerName?: string | null;
  onSaved?: () => void;
}

/** Reusable dialog to register the delivery cost paid to a provider for a sale/order. */
export function DeliveryCostDialog({
  open,
  onOpenChange,
  source,
  storeId,
  posSaleId,
  expeditionOrderId,
  customerName,
  onSaved,
}: Props) {
  const [providers, setProviders] = useState<ServiceProvider[]>([]);
  const [type, setType] = useState<ProviderType>("mototaxi");
  const [providerId, setProviderId] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchProviders(true).then(setProviders).catch(() => {});
    setProviderId("");
    setAmount("");
  }, [open]);

  const filtered = providers.filter((p) => p.provider_type === type);

  const save = async () => {
    if (!providerId) { toast.error("Selecione o prestador"); return; }
    const value = parseFloat(amount);
    if (!value || value <= 0) { toast.error("Informe o valor da entrega"); return; }
    setSaving(true);
    try {
      await createDeliveryCost({
        provider_id: providerId,
        provider_type: type,
        amount: value,
        source,
        store_id: storeId ?? null,
        pos_sale_id: posSaleId ?? null,
        expedition_order_id: expeditionOrderId ?? null,
        customer_name: customerName ?? null,
      });
      toast.success("Custo de entrega registrado! Fica como 'a pagar' ao prestador.");
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro ao registrar: " + (e.message || ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-pos-black border-pos-orange/30">
        <DialogHeader>
          <DialogTitle className="text-pos-white flex items-center gap-2">
            <Truck className="h-5 w-5 text-pos-orange" /> Custo de Entrega
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-pos-white/70 text-xs">Tipo de entrega</Label>
            <Select value={type} onValueChange={(v) => { setType(v as ProviderType); setProviderId(""); }}>
              <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mototaxi">🏍️ Mototaxista</SelectItem>
                <SelectItem value="transportadora">🚚 Transportadora</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-pos-white/70 text-xs">Prestador</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white">
                <SelectValue placeholder={filtered.length ? "Selecione..." : "Nenhum cadastrado deste tipo"} />
              </SelectTrigger>
              <SelectContent>
                {filtered.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtered.length === 0 && (
              <p className="text-[10px] text-pos-white/40 mt-1">Cadastre prestadores em Configurações &gt; Prestadores de Serviço.</p>
            )}
          </div>
          <div>
            <Label className="text-pos-white/70 text-xs">Valor pago ao prestador (R$)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-orange/30 text-pos-white" />
          </div>
          <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-11" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar entrega"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
