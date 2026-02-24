import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  User, Phone, MapPin, CreditCard, Package, Send, Loader2, FileText,
} from "lucide-react";

interface CustomerInfo {
  name: string | null;
  cpf: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  address_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
}

interface SaleItem {
  sale_id: string;
  quantity: number;
  unit_price: number;
  product_name: string;
  variant_name: string | null;
  size: string | null;
  category: string | null;
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
}

interface Props {
  sale: Sale | null;
  onClose: () => void;
  customer: CustomerInfo | null;
  items: SaleItem[];
  sellerName: string | null;
  onResend: (sale: Sale) => void;
  resending: boolean;
}

export function POSSaleDetailDialog({ sale, onClose, customer, items, sellerName, onResend, resending }: Props) {
  if (!sale) return null;

  const date = new Date(sale.created_at);

  return (
    <Dialog open={!!sale} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg bg-[#1a1a2e] border-pos-orange/20 text-pos-white max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-pos-orange flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Detalhes do Pedido
            {sale.tiny_order_number && (
              <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/30 ml-2">
                #{sale.tiny_order_number}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-2">
          <div className="space-y-4">
            {/* Date & Seller */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-pos-white/60">
                {format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </span>
              {sellerName && (
                <Badge variant="outline" className="border-pos-orange/30 text-pos-orange">
                  {sellerName}
                </Badge>
              )}
            </div>

            {/* Customer */}
            {customer && (
              <>
                <Separator className="bg-pos-orange/10" />
                <div className="space-y-2">
                  <h4 className="text-xs uppercase tracking-wider text-pos-white/50 font-medium flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" /> Cliente
                  </h4>
                  <div className="p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10 space-y-1.5">
                    {customer.name && <p className="font-medium text-sm">{customer.name}</p>}
                    {customer.cpf && <p className="text-xs text-pos-white/60">CPF: {customer.cpf}</p>}
                    {customer.whatsapp && (
                      <p className="text-xs text-pos-white/60 flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {customer.whatsapp}
                      </p>
                    )}
                    {customer.email && <p className="text-xs text-pos-white/60">{customer.email}</p>}
                    {customer.address && (
                      <p className="text-xs text-pos-white/60 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {customer.address}{customer.address_number ? `, ${customer.address_number}` : ""}
                        {customer.neighborhood ? ` - ${customer.neighborhood}` : ""}
                        {customer.city ? `, ${customer.city}` : ""}
                        {customer.state ? `/${customer.state}` : ""}
                        {customer.cep ? ` - ${customer.cep}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Items */}
            <Separator className="bg-pos-orange/10" />
            <div className="space-y-2">
              <h4 className="text-xs uppercase tracking-wider text-pos-white/50 font-medium flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" /> Itens ({items.length})
              </h4>
              <div className="space-y-1.5">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-pos-white/5 border border-pos-orange/10">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.product_name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-pos-white/40">
                        {item.variant_name && <span>{item.variant_name}</span>}
                        {item.size && <span>Tam: {item.size}</span>}
                        {item.sku && <span>SKU: {item.sku}</span>}
                      </div>
                    </div>
                    <div className="text-right ml-2 shrink-0">
                      <p className="text-xs text-pos-white/60">{item.quantity}x R$ {item.unit_price.toFixed(2)}</p>
                      <p className="text-sm font-bold text-pos-orange">R$ {(item.quantity * item.unit_price).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment Summary */}
            <Separator className="bg-pos-orange/10" />
            <div className="space-y-2">
              <h4 className="text-xs uppercase tracking-wider text-pos-white/50 font-medium flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5" /> Pagamento
              </h4>
              <div className="p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10 space-y-1.5">
                {sale.payment_method && (
                  <div className="flex justify-between text-sm">
                    <span className="text-pos-white/60">Forma</span>
                    <span>{sale.payment_method}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-pos-white/60">Subtotal</span>
                  <span>R$ {sale.subtotal.toFixed(2)}</span>
                </div>
                {sale.discount > 0 && (
                  <div className="flex justify-between text-sm text-red-400">
                    <span>Desconto</span>
                    <span>-R$ {sale.discount.toFixed(2)}</span>
                  </div>
                )}
                <Separator className="bg-pos-orange/10" />
                <div className="flex justify-between text-base font-bold text-pos-orange">
                  <span>Total</span>
                  <span>R$ {sale.total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Resend Button */}
            <Button
              variant="outline"
              className="w-full gap-2 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10"
              onClick={() => onResend(sale)}
              disabled={resending}
            >
              {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sale.tiny_order_id ? "Reenviar ao Tiny" : "Enviar ao Tiny"}
            </Button>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
