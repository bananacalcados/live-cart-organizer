import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Plus, Trash2, Save, CreditCard, MapPin } from "lucide-react";
import { ExpOrder, SHIPPING_OPTIONS, brl } from "./expeditionTypes";

interface Props {
  order: ExpOrder;
  storeId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

interface PickedItem {
  key: string;
  product_name: string;
  variant_name: string | null;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  unit_price: number;
}

interface ProdRow {
  id: string;
  name: string;
  variant: string | null;
  size: string | null;
  sku: string;
  barcode: string;
  price: number;
  stock: number;
}

const onlyDigits = (v: string) => (v || "").replace(/\D/g, "");

export function ExpAvulsoEditDialog({ order, storeId, open, onOpenChange, onSaved }: Props) {
  const pd: any = order.payment_details || {};
  const addr: any = order.shipping_address || {};

  const [items, setItems] = useState<PickedItem[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProdRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    whatsapp: "",
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
  const [shipping, setShipping] = useState<string>("");
  const [cepLoading, setCepLoading] = useState(false);

  const lookupCep = async (rawCep?: string) => {
    const cep = onlyDigits(rawCep ?? form.cep);
    if (cep.length !== 8) {
      toast.error("Digite um CEP com 8 dígitos");
      return;
    }
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data?.erro) {
        toast.error("CEP não encontrado");
        return;
      }
      setForm((f) => ({
        ...f,
        cep,
        address: data.logradouro || f.address,
        neighborhood: data.bairro || f.neighborhood,
        city: data.localidade || f.city,
        state: (data.uf || f.state || "").toUpperCase(),
        complement: f.complement || data.complemento || "",
      }));
      toast.success("Endereço preenchido pelo CEP");
    } catch (e: any) {
      toast.error("Falha ao consultar CEP");
    } finally {
      setCepLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setItems(
      (order.items || [])
        .filter((i) => i.barcode || i.sku)
        .map((i) => ({
          key: i.id,
          product_name: i.product_name || "",
          variant_name: i.variant_name,
          size: i.size,
          sku: i.sku,
          barcode: i.barcode,
          quantity: i.quantity,
          unit_price: Number(i.unit_price) || 0,
        })),
    );
    setForm({
      name: order.customer_name || pd.customer_name || "",
      phone: order.customer_phone || pd.customer_phone || "",
      whatsapp: pd.customer_whatsapp || order.customer_phone || pd.customer_phone || "",
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
    setShipping(order.shipping_carrier || "");
    setQuery("");
    setResults([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id]);

  const paymentLabel = useMemo(() => {
    const method = (order.payment_method || pd.suggested_payment_method || order.payment_gateway || "").toString();
    const detail = order.payment_method_detail || pd.payment_method_detail || "";
    const installments = pd.installments || pd.parcelas || null;
    const isCard = /card|cart/i.test(method) || /card|cart/i.test(detail);
    const parts: string[] = [];
    if (/pix/i.test(method) || /pix/i.test(detail)) parts.push("PIX");
    else if (isCard) {
      parts.push("Cartão");
      parts.push(installments && Number(installments) > 1 ? `Parcelado ${installments}x` : "À vista");
    } else if (method) parts.push(method.toUpperCase());
    else parts.push("Não identificado");
    if (order.payment_gateway) parts.push(`Gateway: ${order.payment_gateway}`);
    return parts.join(" • ");
  }, [order, pd]);

  const searchProducts = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const { data, error } = await supabase
        .from("pos_products")
        .select("id, name, variant, size, sku, barcode, price, stock")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`)
        .order("name")
        .limit(40);
      if (error) throw error;
      setResults((data || []) as any);
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar produtos");
    } finally {
      setSearching(false);
    }
  };

  const addProduct = (p: ProdRow) => {
    setItems((prev) => [
      ...prev,
      {
        key: `${p.id}-${Date.now()}`,
        product_name: p.name,
        variant_name: p.variant || null,
        size: p.size || null,
        sku: p.sku,
        barcode: p.barcode,
        quantity: 1,
        unit_price: Number(p.price) || 0,
      },
    ]);
  };

  const itemsTotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);

  const validate = () => {
    if (!items.length) return "Selecione ao menos um produto";
    if (!form.name.trim()) return "Informe o nome do cliente";
    if (onlyDigits(form.phone).length < 10) return "Telefone inválido";
    if (onlyDigits(form.whatsapp).length < 10) return "WhatsApp inválido";
    if (onlyDigits(form.cpf).length !== 11) return "CPF inválido";
    if (!form.email.trim() || !form.email.includes("@")) return "E-mail inválido";
    if (!shipping) return "Selecione a forma de envio";
    if (shipping !== "Retirada na loja") {
      if (onlyDigits(form.cep).length !== 8) return "CEP inválido";
      if (!form.address.trim()) return "Informe o endereço";
      if (!form.number.trim()) return "Informe o número";
      if (!form.city.trim() || !form.state.trim()) return "Informe cidade e estado";
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      // 1) Substitui itens do pedido pelos produtos selecionados
      const { error: delErr } = await supabase.from("pos_sale_items").delete().eq("sale_id", order.id);
      if (delErr) throw delErr;

      const { error: insErr } = await supabase.from("pos_sale_items").insert(
        items.map((i) => ({
          sale_id: order.id,
          product_name: i.product_name,
          variant_name: i.variant_name,
          size: i.size,
          sku: i.sku,
          barcode: i.barcode,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total_price: i.unit_price * i.quantity,
        })) as any,
      );
      if (insErr) throw insErr;

      // 2) Dados do cliente + envio (valor da cobrança avulsa é preservado)
      const shippingAddress =
        shipping === "Retirada na loja"
          ? null
          : {
              cep: onlyDigits(form.cep),
              address: form.address,
              number: form.number,
              complement: form.complement,
              neighborhood: form.neighborhood,
              city: form.city,
              state: form.state,
            };

      const { error: upErr } = await supabase
        .from("pos_sales")
        .update({
          customer_name: form.name,
          customer_phone: onlyDigits(form.phone),
          customer_cpf: onlyDigits(form.cpf),
          customer_email: form.email,
          customer_cep: onlyDigits(form.cep) || null,
          customer_city: form.city || null,
          customer_state: form.state || null,
          shipping_address: shippingAddress,
          shipping_carrier: shipping,
          pickup_store_id: shipping === "Retirada na loja" ? storeId : null,
          payment_details: {
            ...pd,
            is_avulso: true,
            avulso_completed: true,
            customer_whatsapp: onlyDigits(form.whatsapp),
            avulso_completed_at: new Date().toISOString(),
          },
        } as any)
        .eq("id", order.id);
      if (upErr) throw upErr;

      toast.success("Pedido avulso completo — pode seguir para Preparação");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar pedido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black flex items-center gap-2">
            Editar pedido <Badge className="bg-amber-500 text-white font-black">AVULSO</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Pagamento (somente leitura) */}
          <div className="rounded-lg border-2 border-pos-border bg-pos-elevated p-3 flex items-center gap-3 flex-wrap">
            <CreditCard className="h-5 w-5 text-pos-muted-text" />
            <span className="text-base font-bold text-pos-text">Pagamento: {paymentLabel}</span>
            <span className="ml-auto text-lg font-black text-pos-text">Cobrado: {brl(order.total)}</span>
          </div>

          {/* Produtos */}
          <div>
            <h3 className="text-lg font-black mb-2">1. Produtos</h3>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-muted-text" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchProducts()}
                  placeholder="Buscar por nome, SKU ou código de barras"
                  className="pl-9 h-11"
                />
              </div>
              <Button onClick={searchProducts} disabled={searching} className="h-11">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
              </Button>
            </div>

            {results.length > 0 && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-pos-border divide-y divide-pos-border">
                {results.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 p-2">
                    <div className="min-w-0">
                      <p className="font-bold text-pos-text truncate">{p.name}</p>
                      <p className="text-sm text-pos-muted-text">
                        {[p.variant, p.size && `Tam ${p.size}`, p.sku].filter(Boolean).join(" • ")} — estoque {p.stock}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold">{brl(p.price)}</span>
                      <Button size="sm" onClick={() => addProduct(p)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 space-y-2">
              {items.map((i, idx) => (
                <div key={i.key} className="flex items-center gap-3 p-2 rounded-lg bg-pos-elevated border border-pos-border">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-pos-text truncate">{i.product_name}</p>
                    <p className="text-sm text-pos-muted-text">
                      {[i.variant_name, i.size && `Tam ${i.size}`, i.sku].filter(Boolean).join(" • ")}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    value={i.quantity}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((p, k) => (k === idx ? { ...p, quantity: Math.max(1, Number(e.target.value) || 1) } : p)),
                      )
                    }
                    className="w-20 h-9"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={i.unit_price}
                    onChange={(e) =>
                      setItems((prev) => prev.map((p, k) => (k === idx ? { ...p, unit_price: Number(e.target.value) || 0 } : p)))
                    }
                    className="w-28 h-9"
                  />
                  <Button variant="ghost" size="sm" onClick={() => setItems((prev) => prev.filter((_, k) => k !== idx))}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {items.length > 0 && (
                <p className="text-right text-base font-bold text-pos-muted-text">
                  Total dos itens: {brl(itemsTotal)}
                  {Math.abs(itemsTotal - Number(order.total)) > 0.01 && (
                    <span className="ml-2 text-amber-600">(difere do valor cobrado)</span>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Cliente */}
          <div>
            <h3 className="text-lg font-black mb-2">2. Dados do cliente</h3>
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
                <Label>WhatsApp</Label>
                <Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label>E-mail</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Envio */}
          <div>
            <h3 className="text-lg font-black mb-2">3. Forma de envio</h3>
            <Select value={shipping} onValueChange={setShipping}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Selecione a forma de envio" />
              </SelectTrigger>
              <SelectContent>
                {SHIPPING_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {shipping !== "Retirada na loja" && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
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
                      onBlur={() => onlyDigits(form.cep).length === 8 && lookupCep()}
                      placeholder="00000-000"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => lookupCep()}
                      disabled={cepLoading}
                      title="Buscar endereço pelo CEP"
                    >
                      {cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Label>Endereço</Label>
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
                  <Input maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving} className="bg-exp-new hover:bg-exp-new/90 text-white font-black">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              SALVAR PEDIDO
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExpAvulsoEditDialog;
