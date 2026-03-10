import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingCart, Instagram, Phone, ExternalLink, Loader2, PackageOpen, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface CartItemData {
  title: string;
  variant: string;
  sku: string | null;
  price: number;
  quantity: number;
  image: string;
  variantGid?: string;
}

interface Registration {
  id: string;
  instagram_handle: string;
  whatsapp: string;
  cart_items: CartItemData[] | null;
  cart_total: number | null;
  status: string;
  checkout_sale_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  catalogLeadPageId: string;
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const statusMap: Record<string, { label: string; color: string }> = {
  registered: { label: "Cadastrado", color: "bg-muted text-muted-foreground" },
  browsing: { label: "Navegando", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  checkout_started: { label: "Checkout", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  paid: { label: "Pago", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
};

export function EventCartsPanel({ catalogLeadPageId }: Props) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailReg, setDetailReg] = useState<Registration | null>(null);

  useEffect(() => {
    loadRegistrations();
    const channel = supabase
      .channel("event-carts")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "catalog_lead_registrations",
        filter: `catalog_page_id=eq.${catalogLeadPageId}`,
      }, () => loadRegistrations())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [catalogLeadPageId]);

  const loadRegistrations = async () => {
    const { data } = await supabase
      .from("catalog_lead_registrations")
      .select("*")
      .eq("catalog_page_id", catalogLeadPageId)
      .order("updated_at", { ascending: false });
    setRegistrations((data as any as Registration[]) || []);
    setLoading(false);
  };

  const withCart = registrations.filter(r => r.cart_items && (r.cart_items as any[]).length > 0);
  const withoutCart = registrations.filter(r => !r.cart_items || (r.cart_items as any[]).length === 0);

  const totalCartsValue = withCart.reduce((s, r) => s + (r.cart_total || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Cadastros" value={registrations.length.toString()} />
        <SummaryCard label="Com Carrinho" value={withCart.length.toString()} />
        <SummaryCard label="Sem Carrinho" value={withoutCart.length.toString()} />
        <SummaryCard label="Valor Total Carrinhos" value={fmt(totalCartsValue)} />
      </div>

      {/* Cart list */}
      {withCart.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <PackageOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>Nenhum carrinho montado ainda</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {withCart.map(reg => (
            <CartCard key={reg.id} reg={reg} onDetail={() => setDetailReg(reg)} />
          ))}
        </div>
      )}

      {/* Without cart section */}
      {withoutCart.length > 0 && (
        <div className="border-t pt-4">
          <p className="text-sm font-medium text-muted-foreground mb-2">
            Cadastrados sem carrinho ({withoutCart.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {withoutCart.map(reg => (
              <Badge key={reg.id} variant="outline" className="gap-1 text-xs">
                <Instagram className="h-3 w-3" />
                @{reg.instagram_handle}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detailReg} onOpenChange={() => setDetailReg(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Carrinho — @{detailReg?.instagram_handle}
            </DialogTitle>
          </DialogHeader>
          {detailReg && (
            <div className="space-y-4">
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <Instagram className="h-4 w-4 text-pink-500" />
                  <span className="font-medium">@{detailReg.instagram_handle}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Phone className="h-4 w-4 text-emerald-500" />
                  <span>{detailReg.whatsapp}</span>
                </div>
              </div>

              <div className="space-y-2">
                {(detailReg.cart_items as any as CartItemData[])?.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                    {item.image && (
                      <img src={item.image} alt="" className="h-14 w-14 rounded object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      {item.variant && (
                        <p className="text-xs text-muted-foreground">{item.variant}</p>
                      )}
                      {item.sku && (
                        <p className="text-[10px] text-muted-foreground font-mono">SKU: {item.sku}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold">{fmt(item.price * item.quantity)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {item.quantity}x {fmt(item.price)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center pt-2 border-t font-bold">
                <span>Total</span>
                <span className="text-primary">{fmt(detailReg.cart_total || 0)}</span>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    const phone = detailReg.whatsapp.replace(/\D/g, "");
                    const fullPhone = phone.length <= 11 ? `55${phone}` : phone;
                    window.open(`https://wa.me/${fullPhone}`, "_blank");
                  }}
                >
                  <Phone className="h-4 w-4 mr-1" />
                  WhatsApp
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    window.open(`https://instagram.com/${detailReg.instagram_handle}`, "_blank");
                  }}
                >
                  <Instagram className="h-4 w-4 mr-1" />
                  Instagram
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function CartCard({ reg, onDetail }: { reg: Registration; onDetail: () => void }) {
  const items = (reg.cart_items as any as CartItemData[]) || [];
  const status = statusMap[reg.status] || statusMap.registered;

  return (
    <div
      className="border rounded-lg bg-card p-3 space-y-2 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onDetail}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Instagram className="h-4 w-4 text-pink-500 shrink-0" />
          <span className="text-sm font-medium truncate">@{reg.instagram_handle}</span>
        </div>
        <Badge className={`text-[10px] ${status.color}`}>{status.label}</Badge>
      </div>

      {/* Phone */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Phone className="h-3 w-3" />
        <span>{reg.whatsapp}</span>
      </div>

      {/* Items preview */}
      <div className="space-y-1">
        {items.slice(0, 3).map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            {item.image && (
              <img src={item.image} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs truncate">{item.title}</p>
              {item.variant && (
                <p className="text-[10px] text-muted-foreground truncate">{item.variant}</p>
              )}
            </div>
            <span className="text-xs font-medium shrink-0">
              {item.quantity}x
            </span>
          </div>
        ))}
        {items.length > 3 && (
          <p className="text-[10px] text-muted-foreground">+{items.length - 3} item(ns)</p>
        )}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between pt-1 border-t">
        <span className="text-xs text-muted-foreground">{items.length} produto(s)</span>
        <span className="text-sm font-bold text-primary">{fmt(reg.cart_total || 0)}</span>
      </div>
    </div>
  );
}
