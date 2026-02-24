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
  User, Phone, MapPin, CreditCard, Package, Send, Loader2, FileText, Mail,
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
}

interface Props {
  sale: Sale | null;
  onClose: () => void;
  customer: CustomerInfo | null;
  items: SaleItem[];
  sellerName: string | null;
  onResend?: (sale: Sale) => void;
  resending?: boolean;
  isTinyOnly?: boolean;
}

export function POSSaleDetailDialog({ sale, onClose, customer, items, sellerName, onResend, resending, isTinyOnly }: Props) {
  if (!sale) return null;

  const date = new Date(sale.created_at);

  return (
    <Dialog open={!!sale} onOpenChange={(open) => !open && onClose()}>
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
              </div>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-2">
          <div className="space-y-4">
            {/* Date & Seller */}
            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
              <span className="text-sm text-gray-600 font-medium">
                {format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </span>
              {sellerName && (
                <Badge className="bg-orange-100 text-orange-700 border-orange-300 font-bold">
                  {sellerName}
                </Badge>
              )}
            </div>

            {/* Customer */}
            {customer && (customer.name || customer.cpf || customer.whatsapp) && (
              <>
                <div className="space-y-2">
                  <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-blue-600" /> Cliente
                  </h4>
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
                    {customer.name && <p className="font-bold text-sm text-gray-900">{customer.name}</p>}
                    {customer.cpf && (
                      <p className="text-xs text-gray-600 font-mono bg-white/60 inline-block px-2 py-0.5 rounded">
                        CPF: {customer.cpf}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      {customer.whatsapp && (
                        <span className="text-xs text-gray-700 flex items-center gap-1 bg-green-50 px-2 py-1 rounded-md border border-green-200">
                          <Phone className="h-3 w-3 text-green-600" /> {customer.whatsapp}
                        </span>
                      )}
                      {customer.email && (
                        <span className="text-xs text-gray-700 flex items-center gap-1 bg-purple-50 px-2 py-1 rounded-md border border-purple-200">
                          <Mail className="h-3 w-3 text-purple-600" /> {customer.email}
                        </span>
                      )}
                    </div>
                    {customer.address && (
                      <div className="flex items-start gap-1.5 mt-1 bg-white/60 p-2 rounded-md">
                        <MapPin className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-gray-700 leading-relaxed">
                          {customer.address}{customer.address_number ? `, ${customer.address_number}` : ""}
                          {customer.neighborhood ? ` - ${customer.neighborhood}` : ""}
                          {customer.city ? `, ${customer.city}` : ""}
                          {customer.state ? `/${customer.state}` : ""}
                          {customer.cep ? ` - CEP: ${customer.cep}` : ""}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Items */}
            <div className="space-y-2">
              <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-orange-500" /> Itens ({items.length})
              </h4>
              <div className="space-y-1.5">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{item.product_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
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
                        {item.sku && (
                          <span className="text-[10px] text-gray-500 font-mono">
                            SKU: {item.sku}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      <p className="text-xs text-gray-500">{item.quantity}x R$ {item.unit_price.toFixed(2)}</p>
                      <p className="text-sm font-bold text-orange-600">R$ {(item.quantity * item.unit_price).toFixed(2)}</p>
                    </div>
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
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Forma</span>
                    <span className="font-semibold text-gray-900">{sale.payment_method}</span>
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
                  <span className="text-xl font-black text-emerald-600">R$ {sale.total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Resend Button */}
            {onResend && (
              <Button
                className="w-full gap-2 bg-orange-500 text-white hover:bg-orange-600 font-bold h-11 text-sm shadow-md"
                onClick={() => onResend(sale)}
                disabled={resending}
              >
                {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sale.tiny_order_id ? "Reenviar ao Tiny" : "Enviar ao Tiny"}
              </Button>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
