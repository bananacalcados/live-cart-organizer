import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { POSTinyProductPicker } from "./POSTinyProductPicker";

interface SaleItemRow {
  id: string;
  product_name: string | null;
  variant_name: string | null;
  unit_price: number;
  quantity: number;
  /** Item ainda não gravado no banco (adicionado agora). */
  isNew?: boolean;
  sku?: string | null;
  barcode?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string;
  onSaved?: () => void;
}

const onlyDigits = (v: string) => (v || "").replace(/\D/g, "");
const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseNum = (v: string) => parseFloat((v || "").replace(",", ".")) || 0;

/**
 * Edição de um pedido de checkout ainda não pago (link já enviado à cliente).
 * Tudo o que é salvo aqui vale para o MESMO link — não é preciso gerar outro.
 */
export function EditPendingCheckoutDialog({ open, onOpenChange, saleId, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<SaleItemRow[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [pd, setPd] = useState<Record<string, any>>({});
  const [storeId, setStoreId] = useState<string>("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [cep, setCep] = useState("");
  const [address, setAddress] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [freeShipping, setFreeShipping] = useState(false);
  const [shippingValue, setShippingValue] = useState("");
  const [discountValue, setDiscountValue] = useState("");

  useEffect(() => {
    if (!open || !saleId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: sale }, { data: rows }] = await Promise.all([
        supabase.from("pos_sales").select("*").eq("id", saleId).maybeSingle(),
        supabase
          .from("pos_sale_items")
          .select("id, product_name, variant_name, unit_price, quantity")
          .eq("sale_id", saleId),
      ]);
      if (cancelled || !sale) { setLoading(false); return; }
      const details = ((sale as any).payment_details || {}) as Record<string, any>;
      setPd(details);
      setStoreId((sale as any).store_id || "");
      setItems((rows || []) as SaleItemRow[]);
      setRemoved([]);
      setName((sale as any).customer_name || details.customer_name || "");
      setPhone((sale as any).customer_phone || details.customer_phone || "");
      setEmail((sale as any).customer_email || details.customer_email || "");
      setCpf((sale as any).customer_cpf || details.customer_cpf || "");
      setCep((sale as any).customer_cep || details.customer_cep || "");
      setAddress(details.customer_address || "");
      setNumber(details.customer_address_number || "");
      setComplement(details.customer_complement || "");
      setNeighborhood(details.customer_neighborhood || "");
      setCity((sale as any).customer_city || details.customer_city || "");
      setState((sale as any).customer_state || details.customer_state || "");
      setFreeShipping(Boolean(details.free_shipping));
      const ship = Number(details.shipping_amount ?? (sale as any).shipping_cost ?? 0);
      setShippingValue(ship ? String(ship) : "");
      const disc = Number((sale as any).discount ?? 0);
      setDiscountValue(disc ? String(disc) : "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, saleId]);

  const lookupCep = async (value: string) => {
    const digits = onlyDigits(value);
    if (digits.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data?.erro) return;
      setAddress((prev) => data.logradouro || prev);
      setNeighborhood((prev) => data.bairro || prev);
      setCity((prev) => data.localidade || prev);
      setState((prev) => data.uf || prev);
    } catch { /* offline: mantém o que a vendedora digitou */ }
  };

  const visibleItems = items.filter((i) => !removed.includes(i.id));
  const subtotal = visibleItems.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0);
  const discount = Math.min(subtotal, parseNum(discountValue));
  const shipping = freeShipping ? 0 : parseNum(shippingValue);
  const total = Math.max(0, subtotal - discount) + shipping;

  const setQty = (id: string, delta: number) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)));

  const setPrice = (id: string, value: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, unit_price: parseNum(value) } : i)));

  const addProduct = (p: { product_name: string; sku: string; unit_price: number; size?: string; barcode?: string }) => {
    if (!p.product_name) return;
    setItems((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        product_name: p.product_name,
        variant_name: p.size || null,
        unit_price: Number(p.unit_price) || 0,
        quantity: 1,
        isNew: true,
        sku: p.sku || null,
        barcode: p.barcode || null,
      },
    ]);
  };


  const handleSave = async () => {
    if (visibleItems.length === 0) { toast.error("O pedido precisa ter ao menos um produto"); return; }
    setSaving(true);
    try {
      const cleanPhone = onlyDigits(phone);
      const cleanCpf = onlyDigits(cpf);
      const cleanCep = onlyDigits(cep);

      const removedExisting = removed.filter((id) => !id.startsWith("new-"));
      if (removedExisting.length) {
        await supabase.from("pos_sale_items").delete().in("id", removedExisting);
      }
      for (const i of visibleItems.filter((i) => !i.isNew)) {
        await supabase
          .from("pos_sale_items")
          .update({ unit_price: Number(i.unit_price), quantity: i.quantity, total_price: Number(i.unit_price) * i.quantity })
          .eq("id", i.id);
      }
      const newRows = visibleItems.filter((i) => i.isNew);
      if (newRows.length) {
        const { error: insErr } = await supabase.from("pos_sale_items").insert(
          newRows.map((i) => ({
            sale_id: saleId,
            sku: i.sku || null,
            barcode: i.barcode || null,
            product_name: i.product_name,
            variant_name: i.variant_name,
            unit_price: Number(i.unit_price),
            quantity: i.quantity,
            total_price: Number(i.unit_price) * i.quantity,
          })) as any,
        );
        if (insErr) throw insErr;
      }

      const payment_details = {
        ...pd,
        customer_name: name || null,
        customer_phone: cleanPhone || null,
        customer_email: email || null,
        customer_cpf: cleanCpf || null,
        customer_cep: cleanCep || null,
        customer_address: address || null,
        customer_address_number: number || null,
        customer_complement: complement || null,
        customer_neighborhood: neighborhood || null,
        customer_city: city || null,
        customer_state: state || null,
        shipping_amount: shipping,
        free_shipping: freeShipping,
        discount_amount: discount,
        items_detail: visibleItems.map((i) => ({
          title: i.product_name,
          variant: i.variant_name,
          unit_price: Number(i.unit_price),
          quantity: i.quantity,
        })),
        edited_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("pos_sales")
        .update({
          customer_name: name || null,
          customer_phone: cleanPhone || null,
          customer_email: email || null,
          customer_cpf: cleanCpf || null,
          customer_cep: cleanCep || null,
          customer_city: city || null,
          customer_state: state || null,
          subtotal,
          discount,
          shipping_cost: shipping,
          total,
          shipping_address: {
            cep: cleanCep || null,
            street: address || null,
            number: number || null,
            complement: complement || null,
            neighborhood: neighborhood || null,
            city: city || null,
            state: state || null,
          } as any,
          payment_details: payment_details as any,
        })
        .eq("id", saleId);
      if (error) throw error;

      toast.success("Pedido atualizado — o mesmo link já mostra as novas informações");
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar o pedido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Editar pedido sem pagamento</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : (
          <>
            <ScrollArea className="flex-1 min-h-0 pr-3">
              <div className="space-y-4">
                {/* Produtos */}
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Produtos</Label>
                  {visibleItems.map((i) => (
                    <div key={i.id} className="flex items-center gap-2 rounded border p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{i.product_name}</p>
                        {i.variant_name && <p className="text-[10px] text-muted-foreground">{i.variant_name}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" className="h-6 w-6 rounded bg-muted flex items-center justify-center" onClick={() => setQty(i.id, -1)}><Minus className="h-3 w-3" /></button>
                        <span className="w-6 text-center text-xs">{i.quantity}</span>
                        <button type="button" className="h-6 w-6 rounded bg-muted flex items-center justify-center" onClick={() => setQty(i.id, 1)}><Plus className="h-3 w-3" /></button>
                      </div>
                      <Input
                        className="h-7 w-20 text-right text-xs"
                        value={String(i.unit_price)}
                        onChange={(e) => setPrice(i.id, e.target.value.replace(/[^\d.,]/g, ""))}
                        inputMode="decimal"
                      />
                      <span className="w-20 text-right text-xs font-bold">{fmt(Number(i.unit_price) * i.quantity)}</span>
                      <button type="button" onClick={() => setRemoved((p) => [...p, i.id])}><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                    </div>
                  ))}

                  {storeId && (
                    <div className="rounded border border-dashed p-2">
                      <POSTinyProductPicker
                        storeId={storeId}
                        label="Adicionar produto"
                        value=""
                        onSelect={addProduct}
                        placeholder="Buscar por nome, SKU ou código de barras..."
                      />
                    </div>
                  )}
                </div>

                {/* Cliente */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Nome do cliente</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">WhatsApp</Label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" />
                  </div>
                  <div>
                    <Label className="text-xs">E-mail</Label>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
                  </div>
                  <div>
                    <Label className="text-xs">CPF</Label>
                    <Input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" />
                  </div>
                </div>

                {/* Endereço */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">CEP</Label>
                    <Input value={cep} onChange={(e) => { setCep(e.target.value); lookupCep(e.target.value); }} inputMode="numeric" />
                  </div>
                  <div>
                    <Label className="text-xs">Endereço</Label>
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Número</Label>
                    <Input value={number} onChange={(e) => setNumber(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Complemento</Label>
                    <Input value={complement} onChange={(e) => setComplement(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Bairro</Label>
                    <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <Label className="text-xs">Cidade</Label>
                      <Input value={city} onChange={(e) => setCity(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">UF</Label>
                      <Input value={state} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} />
                    </div>
                  </div>
                </div>

                {/* Frete e desconto */}
                <div className="grid gap-3 sm:grid-cols-2 border-t pt-3">
                  <div>
                    <Label className="text-xs">Frete (R$)</Label>
                    <Input
                      value={shippingValue}
                      onChange={(e) => setShippingValue(e.target.value.replace(/[^\d.,]/g, ""))}
                      disabled={freeShipping}
                      inputMode="decimal"
                    />
                    <label className="mt-2 flex items-center gap-2 text-xs">
                      <Checkbox checked={freeShipping} onCheckedChange={(v) => setFreeShipping(Boolean(v))} />
                      Frete grátis
                    </label>
                  </div>
                  <div>
                    <Label className="text-xs">Desconto (R$)</Label>
                    <Input
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value.replace(/[^\d.,]/g, ""))}
                      inputMode="decimal"
                    />
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Total: </span>
                <span className="font-bold">{fmt(total)}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  Salvar alterações
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
