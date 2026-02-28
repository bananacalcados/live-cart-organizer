import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  User, Phone, MapPin, CreditCard, Package, Send, Loader2, FileText, Mail, Trash2, AlertTriangle, Pencil, UserPlus, Store, Globe, RotateCcw, Check, X, Plus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { POSCustomerForm } from "./POSCustomerForm";
import { POSTinyProductPicker } from "./POSTinyProductPicker";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface CustomerInfo {
  name: string | null;
  cpf: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  address_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
}

interface SaleItem {
  sale_id?: string;
  quantity: number;
  unit_price: number;
  product_name: string;
  variant_name?: string | null;
  size?: string | null;
  category?: string | null;
  sku?: string | null;
  barcode?: string | null;
}

interface Sale {
  id: string;
  created_at: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: string | null;
  seller_id: string | null;
  status: string;
  tiny_order_number: string | null;
  tiny_order_id: string | null;
  customer_id: string | null;
  sale_type?: string | null;
  payment_details?: Record<string, any> | null;
}

interface Props {
  sale: Sale | null;
  onClose: () => void;
  customer: CustomerInfo | null;
  items: SaleItem[];
  sellerName: string | null;
  sellers?: { id: string; name: string }[];
  onResend?: (sale: Sale) => void;
  resending?: boolean;
  isTinyOnly?: boolean;
  storeId?: string;
  onDeleted?: () => void;
}

export function POSSaleDetailDialog({ sale, onClose, customer, items, sellerName, sellers, onResend, resending, isTinyOnly, storeId, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingPayment, setEditingPayment] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [currentCustomer, setCurrentCustomer] = useState<CustomerInfo | null>(customer);
  const [recovering, setRecovering] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editItemSku, setEditItemSku] = useState("");
  const [savingItem, setSavingItem] = useState(false);
  const [editingSeller, setEditingSeller] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [savingSeller, setSavingSeller] = useState(false);
  const [cancelingTiny, setCancelingTiny] = useState(false);
  const [editingTotal, setEditingTotal] = useState(false);
  const [editTotalValue, setEditTotalValue] = useState("");
  const [savingTotal, setSavingTotal] = useState(false);
  const [deletingTinyOnly, setDeletingTinyOnly] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [newProductQty, setNewProductQty] = useState("1");
  const [currentItems, setCurrentItems] = useState<SaleItem[]>(items);

  useEffect(() => {
    setCurrentItems(items);
  }, [items]);

  useEffect(() => {
    setCurrentCustomer(customer);
  }, [customer]);

  useEffect(() => {
    if (editingPayment && storeId && paymentMethods.length === 0) {
      supabase
        .from('pos_payment_methods')
        .select('id, name')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('sort_order')
        .then(({ data }) => setPaymentMethods(data || []));
    }
  }, [editingPayment, storeId]);

  const handleSavePayment = async () => {
    if (!selectedPaymentId || !sale) return;
    setSavingPayment(true);
    try {
      const method = paymentMethods.find(m => m.id === selectedPaymentId);
      if (!method) return;
      await supabase
        .from('pos_sales')
        .update({ payment_method: method.name } as any)
        .eq('id', sale.id);
      toast.success(`Forma de pagamento alterada para ${method.name}`);
      setEditingPayment(false);
      onDeleted?.(); // refresh list
    } catch (e) {
      toast.error("Erro ao alterar pagamento");
    } finally {
      setSavingPayment(false);
    }
  };

  const handleSaveSeller = async () => {
    if (!selectedSellerId || !sale) return;
    setSavingSeller(true);
    try {
      await supabase
        .from('pos_sales')
        .update({ seller_id: selectedSellerId } as any)
        .eq('id', sale.id);
      const newName = sellers?.find(s => s.id === selectedSellerId)?.name;
      toast.success(`Vendedora alterada para ${newName}`);
      setEditingSeller(false);
      onDeleted?.();
    } catch {
      toast.error("Erro ao alterar vendedora");
    } finally {
      setSavingSeller(false);
    }
  };

  const handleCancelTinyAndResend = async () => {
    if (!sale || !storeId || !sale.tiny_order_id) return;
    setCancelingTiny(true);
    try {
      // 1. Cancel existing Tiny order
      const delResp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-delete-sale`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ store_id: storeId, sale_id: sale.id, cancel_tiny_only: true }),
      });
      const delData = await delResp.json();
      if (!delData.success) {
        toast.error(delData.error || "Erro ao cancelar pedido no Tiny");
        return;
      }

      // 2. Clear tiny references locally
      await supabase
        .from('pos_sales')
        .update({ tiny_order_id: null, tiny_order_number: null, status: 'pending_sync' } as any)
        .eq('id', sale.id);

      toast.success("Pedido cancelado no Tiny! Reenviando...");

      // 3. Resend
      if (onResend) {
        onResend({ ...sale, tiny_order_id: null, tiny_order_number: null });
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao cancelar/reenviar");
    } finally {
      setCancelingTiny(false);
    }
  };

  const handleSaveTotal = async () => {
    if (!sale) return;
    const newTotal = parseFloat(editTotalValue);
    if (isNaN(newTotal) || newTotal < 0) { toast.error("Valor inválido"); return; }
    setSavingTotal(true);
    try {
      await supabase.from('pos_sales').update({ total: newTotal } as any).eq('id', sale.id);
      toast.success(`Valor alterado para R$ ${newTotal.toFixed(2)}`);
      setEditingTotal(false);
      onDeleted?.();
    } catch {
      toast.error("Erro ao alterar valor");
    } finally {
      setSavingTotal(false);
    }
  };

  const handleDeleteTinyOnly = async () => {
    if (!sale || !storeId || !sale.tiny_order_id) return;
    if (!confirm("Excluir este pedido do Tiny ERP? O pedido local será mantido.")) return;
    setDeletingTinyOnly(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-delete-sale`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ store_id: storeId, sale_id: sale.id, cancel_tiny_only: true }),
      });
      const data = await resp.json();
      if (data.success) {
        await supabase.from('pos_sales').update({ tiny_order_id: null, tiny_order_number: null, status: 'pending_sync' } as any).eq('id', sale.id);
        toast.success("Pedido excluído do Tiny!");
        onDeleted?.();
        onClose();
      } else {
        toast.error(data.error || "Erro ao excluir do Tiny");
      }
    } catch {
      toast.error("Erro ao excluir do Tiny");
    } finally {
      setDeletingTinyOnly(false);
    }
  };

  const handleAddProduct = async (product: { product_name: string; sku: string; unit_price: number; size?: string; tiny_id?: number; barcode?: string }) => {
    if (!product.product_name || !sale) return;
    setAddingProduct(true);
    try {
      const qty = parseInt(newProductQty) || 1;
      const totalPrice = product.unit_price * qty;
      
      await supabase.from('pos_sale_items').insert({
        sale_id: sale.id,
        product_name: product.product_name,
        sku: product.sku || null,
        barcode: product.barcode || null,
        unit_price: product.unit_price,
        quantity: qty,
        total_price: totalPrice,
        size: product.size || null,
        tiny_product_id: product.tiny_id || null,
      } as any);

      // Update sale total
      const newTotal = sale.total + totalPrice;
      const newSubtotal = sale.subtotal + totalPrice;
      await supabase.from('pos_sales').update({ 
        total: newTotal, 
        subtotal: newSubtotal 
      } as any).eq('id', sale.id);

      // Update local items list
      setCurrentItems(prev => [...prev, {
        sale_id: sale.id,
        product_name: product.product_name,
        quantity: qty,
        unit_price: product.unit_price,
        sku: product.sku || null,
        barcode: product.barcode || null,
        size: product.size || null,
      }]);

      toast.success(`${product.product_name} adicionado ao pedido!`);
      setShowAddProduct(false);
      setNewProductQty("1");
      onDeleted?.(); // refresh parent
    } catch (e: any) {
      toast.error("Erro ao adicionar produto: " + e.message);
    } finally {
      setAddingProduct(false);
    }
  };

  const handleRecoverCustomer = async () => {
    if (!sale) return;
    setRecovering(true);
    try {
      let customerName: string | null = null;
      let customerPhone: string | null = null;
      let customerEmail: string | null = null;
      let customerCpf: string | null = null;
      let customerAddress: Record<string, string | null> = {};

      // Source 1: pos_checkout_attempts
      const { data: attempt } = await supabase
        .from("pos_checkout_attempts")
        .select("customer_name, customer_phone, customer_email, metadata")
        .eq("sale_id", sale.id)
        .eq("status", "success")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (attempt?.customer_name) {
        customerName = attempt.customer_name;
        customerPhone = attempt.customer_phone;
        customerEmail = attempt.customer_email;
        // Extract CPF and address from metadata if available
        const meta = attempt.metadata as Record<string, any> | null;
        if (meta) {
          if (meta.cpf) customerCpf = meta.cpf;
          if (meta.cep || meta.address) {
            customerAddress = {
              address: meta.address || null, address_number: meta.address_number || null,
              complement: meta.complement || null, neighborhood: meta.neighborhood || null,
              city: meta.city || null, state: meta.state || null, cep: meta.cep || null,
            };
          }
        }
      }

      // Source 2: customer_registrations (always check for additional data like CPF/address)
      const { data: reg } = await supabase
        .from("customer_registrations")
        .select("full_name, whatsapp, email, cpf, address, address_number, complement, neighborhood, city, state, cep")
        .eq("order_id", sale.id)
        .maybeSingle();
      if (reg) {
        if (!customerName && reg.full_name) {
          customerName = reg.full_name;
          customerPhone = reg.whatsapp;
          customerEmail = reg.email;
        }
        if (!customerCpf && reg.cpf) customerCpf = reg.cpf;
        if (!customerAddress.address && reg.address) {
          customerAddress = {
            address: reg.address, address_number: reg.address_number,
            complement: reg.complement || null, neighborhood: reg.neighborhood,
            city: reg.city, state: reg.state, cep: reg.cep,
          };
        }
      }

      // Source 3: payment_details on the sale itself
      if (!customerName && sale.payment_details) {
        const pd = sale.payment_details as Record<string, any>;
        if (pd.customer_name) {
          customerName = pd.customer_name;
          customerPhone = pd.customer_phone || null;
          customerEmail = pd.customer_email || null;
        }
        if (!customerCpf && pd.customer_cpf) customerCpf = pd.customer_cpf;
        if (!customerAddress.address && pd.customer_address) {
          customerAddress = {
            address: pd.customer_address || null, address_number: pd.customer_address_number || null,
            complement: pd.customer_complement || null, neighborhood: pd.customer_neighborhood || null,
            city: pd.customer_city || null, state: pd.customer_state || null, cep: pd.customer_cep || null,
          };
        }
      }

      if (!customerName) {
        toast.error("Nenhum dado de cliente encontrado para esta venda");
        return;
      }

      const phoneDigits = (customerPhone || "").replace(/\D/g, "");
      const cpfDigits = (customerCpf || "").replace(/\D/g, "");

      // Find or create customer
      let customerId: string | null = null;
      if (cpfDigits) {
        const { data: existing } = await supabase
          .from("pos_customers")
          .select("id")
          .eq("cpf", cpfDigits)
          .maybeSingle();
        if (existing) customerId = existing.id;
      }
      if (!customerId && phoneDigits) {
        const { data: existing } = await supabase
          .from("pos_customers")
          .select("id")
          .eq("whatsapp", phoneDigits)
          .maybeSingle();
        if (existing) customerId = existing.id;
      }

      const payload: Record<string, any> = {
        name: customerName,
        whatsapp: phoneDigits || null,
        email: customerEmail || null,
      };
      if (cpfDigits) payload.cpf = cpfDigits;
      if (customerAddress.address) {
        Object.assign(payload, customerAddress);
      }

      if (customerId) {
        await supabase.from("pos_customers").update(payload).eq("id", customerId);
      } else {
        const { data: newCust } = await supabase
          .from("pos_customers")
          .insert(payload)
          .select("id")
          .single();
        customerId = newCust?.id || null;
      }

      if (customerId) {
        await supabase.from("pos_sales").update({ customer_id: customerId } as any).eq("id", sale.id);
        const { data: freshCust } = await supabase
          .from("pos_customers")
          .select("name, cpf, whatsapp, email, address, address_number, complement, neighborhood, city, state, cep")
          .eq("id", customerId)
          .maybeSingle();
        if (freshCust) setCurrentCustomer(freshCust as CustomerInfo);
        toast.success("Cliente recuperado e vinculado!");
        onDeleted?.();
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao recuperar dados do cliente");
    } finally {
      setRecovering(false);
    }
  };

  if (!sale) return null;

  const date = new Date(sale.created_at);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (!storeId) {
      toast.error("Store ID não disponível");
      return;
    }
    setDeleting(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-delete-sale`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ store_id: storeId, sale_id: sale.id }),
      });
      const data = await resp.json();
      if (data.success) {
        const msgs = (data.messages || []).join("\n");
        toast.success("Venda excluída!\n" + msgs);
        onClose();
        onDeleted?.();
      } else {
        toast.error(data.error || "Erro ao excluir venda");
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao excluir venda");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Dialog open={!!sale} onOpenChange={(open) => { if (!open) { onClose(); setConfirmDelete(false); } }}>
      <DialogContent className="max-w-lg bg-white border-2 border-orange-400/40 text-gray-900 max-h-[90vh] shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-orange-500 flex items-center justify-center">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-gray-900 text-lg">
                Detalhes do Pedido
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1">
                {sale.tiny_order_number ? (
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 font-bold text-xs">
                    Tiny #{sale.tiny_order_number}
                  </Badge>
                ) : sale.status === 'pending_sync' ? (
                  <Badge className="bg-amber-100 text-amber-700 border-amber-300 font-bold text-xs">
                    Pendente Tiny
                  </Badge>
                ) : isTinyOnly ? (
                  <Badge className="bg-purple-100 text-purple-700 border-purple-300 font-bold text-xs">
                    Pedido Tiny
                  </Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-700 border-red-300 font-bold text-xs">
                    Não criado no Tiny
                  </Badge>
                )}
                {sale.sale_type === 'online' ? (
                  <Badge className="bg-blue-100 text-blue-700 border-blue-300 font-bold text-xs flex items-center gap-1">
                    <Globe className="h-3 w-3" /> Online
                  </Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-700 border-green-300 font-bold text-xs flex items-center gap-1">
                    <Store className="h-3 w-3" /> Loja
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-2">
          <div className="space-y-4">
            {/* Date & Seller */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 font-medium">
                  {format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </span>
                <div className="flex items-center gap-1.5">
                  {sellerName && (
                    <Badge className="bg-orange-100 text-orange-700 border-orange-300 font-bold">
                      {sellerName}
                    </Badge>
                  )}
                  {!isTinyOnly && sellers && sellers.length > 0 && (
                    <button onClick={() => { setEditingSeller(!editingSeller); if (!editingSeller && sale.seller_id) setSelectedSellerId(sale.seller_id); }} className="text-blue-500 hover:text-blue-700">
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
              {editingSeller && sellers && (
                <div className="flex gap-2 items-center">
                  <Select value={selectedSellerId} onValueChange={setSelectedSellerId}>
                    <SelectTrigger className="flex-1 h-8 text-xs">
                      <SelectValue placeholder="Selecione vendedora..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sellers.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-8 text-xs bg-blue-500 hover:bg-blue-600 text-white" onClick={handleSaveSeller} disabled={savingSeller || !selectedSellerId}>
                    {savingSeller ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              )}
            </div>

            {/* Customer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-blue-600" /> Cliente
                </h4>
                <div className="flex items-center gap-1">
                  {sale.sale_type === 'online' && storeId && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 border-orange-300 text-orange-600 hover:bg-orange-50"
                      onClick={handleRecoverCustomer}
                      disabled={recovering}
                    >
                      {recovering ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      Puxar Dados
                    </Button>
                  )}
                  {!isTinyOnly && storeId && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 border-blue-300 text-blue-600 hover:bg-blue-50"
                      onClick={() => setShowCustomerForm(true)}
                    >
                      {currentCustomer ? <Pencil className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />}
                      {currentCustomer ? "Editar" : "Adicionar"}
                    </Button>
                  )}
                </div>
              </div>
              {currentCustomer && (currentCustomer.name || currentCustomer.cpf || currentCustomer.whatsapp) ? (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
                  {currentCustomer.name && <p className="font-bold text-sm text-gray-900">{currentCustomer.name}</p>}
                  {currentCustomer.cpf && (
                    <p className="text-xs text-gray-600 font-mono bg-white/60 inline-block px-2 py-0.5 rounded">
                      CPF: {currentCustomer.cpf}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {currentCustomer.whatsapp && (
                      <span className="text-xs text-gray-700 flex items-center gap-1 bg-green-50 px-2 py-1 rounded-md border border-green-200">
                        <Phone className="h-3 w-3 text-green-600" /> {currentCustomer.whatsapp}
                      </span>
                    )}
                    {currentCustomer.email && (
                      <span className="text-xs text-gray-700 flex items-center gap-1 bg-purple-50 px-2 py-1 rounded-md border border-purple-200">
                        <Mail className="h-3 w-3 text-purple-600" /> {currentCustomer.email}
                      </span>
                    )}
                  </div>
                  {currentCustomer.address && (
                    <div className="flex items-start gap-1.5 mt-1 bg-white/60 p-2 rounded-md">
                      <MapPin className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-gray-700 leading-relaxed">
                        {currentCustomer.address}{currentCustomer.address_number ? `, ${currentCustomer.address_number}` : ""}{currentCustomer.complement ? ` - ${currentCustomer.complement}` : ""}
                        {currentCustomer.neighborhood ? ` - ${currentCustomer.neighborhood}` : ""}
                        {currentCustomer.city ? `, ${currentCustomer.city}` : ""}
                        {currentCustomer.state ? `/${currentCustomer.state}` : ""}
                        {currentCustomer.cep ? ` - CEP: ${currentCustomer.cep}` : ""}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-center">
                  <p className="text-xs text-gray-400">Nenhum cliente vinculado</p>
                </div>
              )}
            </div>

            {/* Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-orange-500" /> Itens ({currentItems.length})
                </h4>
                {!isTinyOnly && storeId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 border-emerald-300 text-emerald-600 hover:bg-emerald-50"
                    onClick={() => setShowAddProduct(!showAddProduct)}
                  >
                    <Plus className="h-3 w-3" />
                    Adicionar Produto
                  </Button>
                )}
              </div>

              {/* Add Product Form */}
              {showAddProduct && storeId && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-2">
                  <POSTinyProductPicker
                    storeId={storeId}
                    label="Buscar produto para adicionar"
                    value=""
                    onSelect={(product) => {
                      if (product.product_name) handleAddProduct(product);
                    }}
                    placeholder="Nome, SKU ou código de barras..."
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Qtd:</span>
                    <Input
                      type="number"
                      min="1"
                      value={newProductQty}
                      onChange={(e) => setNewProductQty(e.target.value)}
                      className="h-7 w-16 text-xs text-center"
                    />
                    {addingProduct && <Loader2 className="h-3 w-3 animate-spin text-emerald-600" />}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                {currentItems.map((item, i) => (
                  <div key={i} className="p-3 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{item.product_name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {item.variant_name && (
                            <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">
                              {item.variant_name}
                            </span>
                          )}
                          {item.size && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                              Tam: {item.size}
                            </span>
                          )}
                          {item.sku && editingItemIndex !== i && (
                            <span className="text-[10px] text-gray-500 font-mono flex items-center gap-1">
                              SKU: {item.sku}
                              {!isTinyOnly && (
                                <button
                                  onClick={() => { setEditingItemIndex(i); setEditItemSku(item.sku || ""); }}
                                  className="text-blue-500 hover:text-blue-700"
                                >
                                  <Pencil className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </span>
                          )}
                          {!item.sku && editingItemIndex !== i && !isTinyOnly && (
                            <button
                              onClick={() => { setEditingItemIndex(i); setEditItemSku(""); }}
                              className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-0.5"
                            >
                              <Pencil className="h-2.5 w-2.5" /> Adicionar SKU
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-right ml-3 shrink-0">
                        <p className="text-xs text-gray-500">{item.quantity}x R$ {item.unit_price.toFixed(2)}</p>
                        <p className="text-sm font-bold text-orange-600">R$ {(item.quantity * item.unit_price).toFixed(2)}</p>
                      </div>
                    </div>
                    {editingItemIndex === i && (
                      <div className="flex gap-2 items-center mt-2 pt-2 border-t border-gray-200">
                        <Input
                          value={editItemSku}
                          onChange={(e) => setEditItemSku(e.target.value)}
                          placeholder="Novo SKU do produto"
                          className="flex-1 h-8 text-xs font-mono"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          className="h-8 w-8 p-0 bg-emerald-500 hover:bg-emerald-600 text-white"
                          disabled={savingItem}
                          onClick={async () => {
                            if (!sale || !item.sale_id) return;
                            setSavingItem(true);
                            try {
                              await supabase
                                .from('pos_sale_items')
                                .update({ sku: editItemSku } as any)
                                .eq('sale_id', item.sale_id)
                                .eq('product_name', item.product_name)
                                .eq('unit_price', item.unit_price);
                              const updated = [...currentItems];
                              updated[i] = { ...updated[i], sku: editItemSku };
                              setCurrentItems(updated);
                              toast.success("SKU atualizado!");
                              setEditingItemIndex(null);
                              onDeleted?.();
                            } catch {
                              toast.error("Erro ao salvar SKU");
                            } finally {
                              setSavingItem(false);
                            }
                          }}
                        >
                          {savingItem ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          onClick={() => setEditingItemIndex(null)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Payment Summary */}
            <div className="space-y-2">
              <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-emerald-500" /> Pagamento
              </h4>
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-2">
                {sale.payment_method && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Forma</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-gray-900">{sale.payment_method}</span>
                      {!isTinyOnly && storeId && (
                        <button onClick={() => setEditingPayment(!editingPayment)} className="text-blue-500 hover:text-blue-700">
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {editingPayment && (
                  <div className="flex gap-2 items-center">
                    <Select value={selectedPaymentId} onValueChange={setSelectedPaymentId}>
                      <SelectTrigger className="flex-1 h-8 text-xs">
                        <SelectValue placeholder="Nova forma" />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethods.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8 text-xs bg-blue-500 hover:bg-blue-600 text-white" onClick={handleSavePayment} disabled={savingPayment || !selectedPaymentId}>
                      {savingPayment ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
                    </Button>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="text-gray-900">R$ {sale.subtotal.toFixed(2)}</span>
                </div>
                {sale.discount > 0 && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>Desconto</span>
                    <span className="font-semibold">-R$ {sale.discount.toFixed(2)}</span>
                  </div>
                )}
                <Separator className="bg-emerald-200" />
                <div className="flex justify-between items-center">
                  <span className="text-base font-bold text-gray-900">Total</span>
                  <div className="flex items-center gap-1.5">
                    {editingTotal ? (
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium">R$</span>
                        <Input value={editTotalValue} onChange={(e) => setEditTotalValue(e.target.value)} className="h-8 w-28 text-right font-bold text-base" type="number" step="0.01" autoFocus />
                        <Button size="sm" className="h-8 w-8 p-0 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={handleSaveTotal} disabled={savingTotal}>
                          {savingTotal ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setEditingTotal(false)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="text-xl font-black text-emerald-600">R$ {sale.total.toFixed(2)}</span>
                        {!isTinyOnly && storeId && (
                          <button onClick={() => { setEditingTotal(true); setEditTotalValue(sale.total.toFixed(2)); }} className="text-blue-500 hover:text-blue-700">
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Mark as Paid */}
            {!isTinyOnly && sale.status !== 'paid' && sale.status !== 'completed' && (
              <Button
                className="w-full gap-2 bg-emerald-500 text-white hover:bg-emerald-600 font-bold h-11 text-sm shadow-md"
                onClick={async () => {
                  setMarkingPaid(true);
                  try {
                    await supabase
                      .from('pos_sales')
                      .update({ status: 'paid', expedition_status: 'pending' } as any)
                      .eq('id', sale.id);
                    toast.success('Pedido marcado como pago!');
                    onDeleted?.();
                    onClose();
                  } catch {
                    toast.error('Erro ao marcar como pago');
                  } finally {
                    setMarkingPaid(false);
                  }
                }}
                disabled={markingPaid}
              >
                {markingPaid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Marcar como Pago
              </Button>
            )}

            {/* Action Buttons */}
            <div className="space-y-2">
              {onResend && (
                <Button
                  className="w-full gap-2 bg-orange-500 text-white hover:bg-orange-600 font-bold h-11 text-sm shadow-md"
                  onClick={() => onResend(sale)}
                  disabled={resending || cancelingTiny}
                >
                  {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sale.tiny_order_id ? "Reenviar ao Tiny" : "Enviar ao Tiny"}
                </Button>
              )}

              {/* Cancel Tiny order and resend with updated data */}
              {onResend && sale.tiny_order_id && !isTinyOnly && storeId && (
                <Button
                  variant="outline"
                  className="w-full gap-2 font-bold h-11 text-sm border-amber-400 text-amber-700 hover:bg-amber-50"
                  onClick={handleCancelTinyAndResend}
                  disabled={cancelingTiny || resending}
                >
                  {cancelingTiny ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  Cancelar no Tiny e Reenviar
                </Button>
              )}

              {/* Delete from Tiny only */}
              {sale.tiny_order_id && !isTinyOnly && storeId && (
                <Button
                  variant="outline"
                  className="w-full gap-2 font-bold h-11 text-sm border-orange-300 text-orange-600 hover:bg-orange-50"
                  onClick={handleDeleteTinyOnly}
                  disabled={deletingTinyOnly || cancelingTiny}
                >
                  {deletingTinyOnly ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Excluir do Tiny
                </Button>
              )}

              {/* Delete button - only for local sales, not tiny-only */}
              {!isTinyOnly && storeId && (
                <Button
                  variant="outline"
                  className={`w-full gap-2 font-bold h-11 text-sm ${confirmDelete ? 'bg-red-500 text-white hover:bg-red-600 border-red-500' : 'border-red-300 text-red-600 hover:bg-red-50'}`}
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : confirmDelete ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {deleting ? "Excluindo..." : confirmDelete ? "Confirmar exclusão (cancela NFC-e e pedido Tiny)" : "Excluir Venda"}
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Customer Form Dialog */}
        {showCustomerForm && sale && (
          <POSCustomerForm
            open={showCustomerForm}
            onOpenChange={setShowCustomerForm}
            existingCustomer={sale.customer_id && currentCustomer ? {
              id: sale.customer_id,
              name: currentCustomer.name || undefined,
              email: currentCustomer.email || undefined,
              whatsapp: currentCustomer.whatsapp || undefined,
              cpf: currentCustomer.cpf || undefined,
              cep: currentCustomer.cep || undefined,
              address: currentCustomer.address || undefined,
              address_number: currentCustomer.address_number || undefined,
              complement: currentCustomer.complement || undefined,
              neighborhood: currentCustomer.neighborhood || undefined,
              city: currentCustomer.city || undefined,
              state: currentCustomer.state || undefined,
            } : null}
            onSaved={async (savedCustomer) => {
              // Link customer to sale if not already linked
              await supabase
                .from("pos_sales")
                .update({ customer_id: savedCustomer.id } as any)
                .eq("id", sale.id);
              // Refresh customer data
              const { data: freshCust } = await supabase
                .from("pos_customers")
                .select("name, cpf, whatsapp, email, address, address_number, complement, neighborhood, city, state, cep")
                .eq("id", savedCustomer.id)
                .maybeSingle();
              if (freshCust) setCurrentCustomer(freshCust as CustomerInfo);
              toast.success("Cliente vinculado à venda!");
              setShowCustomerForm(false);
              onDeleted?.(); // refresh list
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
