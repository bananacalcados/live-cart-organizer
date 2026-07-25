import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MapPin, Save, Pencil } from "lucide-react";
import { ExpOrder, isPickup } from "./expeditionTypes";
import { ExpShippingFields, ShippingFieldsValue } from "./ExpShippingFields";
import { saveExpeditionShippingCost } from "./shippingCost";

interface Props {
  order: ExpOrder;
  storeId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

const onlyDigits = (v: string) => (v || "").replace(/\D/g, "");

/**
 * Edição dos dados do pedido/NF-e (cliente + endereço + envio) em qualquer etapa
 * da expedição. NÃO altera itens da venda — evita novos movimentos de estoque.
 */
export function ExpOrderEditDialog({ order, storeId, open, onOpenChange, onSaved }: Props) {
  const pd: any = order.payment_details || {};
  const addr: any = order.shipping_address || {};

  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    cpf: "",
    email: "",
    cep: "",
    address: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
  });
  const [shipping, setShipping] = useState<ShippingFieldsValue>({
    carrier: "",
    courier: "",
    courierProviderId: "",
    cost: "",
  });
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [sellerId, setSellerId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    supabase
      .from("pos_sellers")
      .select("id, name")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setSellers((data as any) || []));
  }, [open, storeId]);

  useEffect(() => {
    if (!open) return;
    setSellerId(order.seller_id || "");
    setForm({
      name: order.customer_name || pd.customer_name || "",
      phone: order.customer_phone || pd.customer_phone || "",
      cpf: order.customer_cpf || pd.customer_cpf || "",
      email: order.customer_email || pd.customer_email || "",
      cep: addr.cep || pd.customer_cep || "",
      address: addr.address || pd.customer_address || "",
      number: addr.number || pd.customer_address_number || "",
      complement: addr.complement || pd.customer_complement || "",
      neighborhood: addr.neighborhood || pd.customer_neighborhood || "",
      city: addr.city || pd.customer_city || "",
      state: addr.state || pd.customer_state || "",
    });
    setShipping({
      carrier: order.shipping_carrier || order.delivery_method || "",
      courier: order.courier_name || "",
      courierProviderId: "",
      cost: order.shipping_cost != null ? String(order.shipping_cost) : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id]);



  const lookupCep = async (rawCep?: string) => {
    const cep = onlyDigits(rawCep ?? form.cep);
    if (cep.length !== 8) return toast.error("Digite um CEP com 8 dígitos");
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data?.erro) return toast.error("CEP não encontrado");
      setForm((f) => ({
        ...f,
        cep,
        address: data.logradouro || f.address,
        neighborhood: data.bairro || f.neighborhood,
        city: data.localidade || f.city,
        state: (data.uf || f.state || "").toUpperCase(),
      }));
      toast.success("Endereço preenchido pelo CEP");
    } catch {
      toast.error("Falha ao consultar CEP");
    } finally {
      setCepLoading(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Informe o nome do cliente");
    if (!isPickup(shipping.carrier) && shipping.carrier) {
      if (onlyDigits(form.cep).length !== 8) return toast.error("CEP inválido (obrigatório para NF-e)");
      if (!form.address.trim()) return toast.error("Informe o logradouro (obrigatório para NF-e)");
      if (!form.number.trim()) return toast.error("Informe o número");
      if (!form.neighborhood.trim()) return toast.error("Informe o bairro");
      if (!form.city.trim() || !form.state.trim()) return toast.error("Informe cidade e UF");
    }

    setSaving(true);
    try {
      const shippingAddress = isPickup(shipping.carrier)
        ? order.shipping_address
        : {
            ...(addr || {}),
            cep: onlyDigits(form.cep),
            address: form.address.trim(),
            number: form.number.trim(),
            complement: form.complement.trim(),
            neighborhood: form.neighborhood.trim(),
            city: form.city.trim(),
            state: form.state.trim().toUpperCase(),
          };

      const { error } = await supabase
        .from("pos_sales")
        .update({
          customer_name: form.name.trim(),
          customer_phone: onlyDigits(form.phone) || null,
          customer_cpf: onlyDigits(form.cpf) || null,
          customer_email: form.email.trim() || null,
          customer_cep: onlyDigits(form.cep) || null,
          customer_city: form.city.trim() || null,
          customer_state: form.state.trim().toUpperCase() || null,
          shipping_address: shippingAddress,
          shipping_carrier: shipping.carrier || null,
          tracking_carrier: shipping.carrier || null,
          courier_name: shipping.courier.trim() || null,
          pickup_store_id: isPickup(shipping.carrier) ? storeId : null,
        } as any)
        .eq("id", order.id);
      if (error) throw error;

      await saveExpeditionShippingCost({
        saleId: order.id,
        storeId,
        carrier: shipping.carrier,
        courierProviderId: shipping.courierProviderId,
        courierName: shipping.courier,
        cost: Number(shipping.cost) || 0,
        customerName: form.name.trim(),
      });

      toast.success("Dados do pedido atualizados");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar dados do pedido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black flex items-center gap-2">
            <Pencil className="h-6 w-6 text-exp-prep" /> Editar dados do pedido / NF-e
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <h3 className="text-lg font-black mb-2">1. Cliente</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Nome completo</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>CPF</Label>
                <Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-black mb-2">2. Endereço de entrega (usado na NF-e)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>CEP</Label>
                <div className="flex gap-2">
                  <Input
                    value={form.cep}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm({ ...form, cep: v });
                      if (onlyDigits(v).length === 8) lookupCep(v);
                    }}
                    placeholder="00000-000"
                  />
                  <Button type="button" variant="outline" onClick={() => lookupCep()} disabled={cepLoading}>
                    {cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="md:col-span-2">
                <Label>Logradouro</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div>
                <Label>Número</Label>
                <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
              </div>
              <div>
                <Label>Complemento</Label>
                <Input value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} />
              </div>
              <div>
                <Label>Bairro</Label>
                <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label>Cidade</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <Label>UF</Label>
                <Input
                  maxLength={2}
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-black mb-2">3. Envio</h3>
            <ExpShippingFields value={shipping} onChange={setShipping} compact />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving} className="bg-exp-prep hover:bg-exp-prep/90 text-white font-black">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              SALVAR DADOS
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExpOrderEditDialog;
