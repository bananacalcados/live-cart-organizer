import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store, Home, ShoppingCart, DollarSign, RotateCcw, MessageSquare,
  ArrowRightLeft, Settings, Trophy, Phone, Bell, BarChart3, SearchX,
  Menu, X, Package, Globe, Lock, Loader2, CreditCard, Flame, Truck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { POSStoreSelector } from "@/components/pos/POSStoreSelector";
import { POSSalesView } from "@/components/pos/POSSalesView";
import { POSCashRegister } from "@/components/pos/POSCashRegister";

import { lazy, Suspense } from "react";
const POSConfig = lazy(() => import("@/components/pos/POSConfig").then(m => ({ default: m.POSConfig })));
import { POSExchanges } from "@/components/pos/POSExchanges";
import { POSInterStoreRequests } from "@/components/pos/POSInterStoreRequests";
import { POSWhatsApp } from "@/components/pos/POSWhatsApp";
import { POSProductSearchLog } from "@/components/pos/POSProductSearchLog";
import { POSDailySales } from "@/components/pos/POSDailySales";
import { POSPickupOrders } from "@/components/pos/POSPickupOrders";
import { POSTeamChat } from "@/components/pos/POSTeamChat";
import { POSSlowMovingProducts } from "@/components/pos/POSSlowMovingProducts";
import { POSShipments } from "@/components/pos/POSShipments";
import { POSSellerDashboard } from "@/components/pos/POSSellerDashboard";
import { POSDashboard } from "@/components/pos/POSDashboard";
import { POSOnlineSales } from "@/components/pos/POSOnlineSales";
import { POSCheckoutMonitor } from "@/components/pos/POSCheckoutMonitor";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type POSSection = "dashboard" | "sales" | "online" | "cash" | "returns" | "chat" | "requests" | "config" | "whatsapp" | "daily" | "searches" | "pickups" | "checkout" | "slowmoving" | "shipments" | "seller-dashboard";
type WhatsAppFilter = "unanswered" | "new" | undefined;

const CONFIG_PIN = "1530";

const SECTIONS: { id: POSSection; label: string; icon: typeof ShoppingCart; badge?: boolean; priority?: boolean }[] = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3, priority: true },
  { id: "sales", label: "Venda", icon: ShoppingCart, priority: true },
  { id: "daily", label: "Pedidos", icon: BarChart3, priority: true },
  { id: "online", label: "Online", icon: Globe, priority: true },
  { id: "shipments", label: "Envios", icon: Truck, priority: true, badge: true },
  { id: "pickups", label: "Retiradas", icon: Package, priority: true, badge: true },
  { id: "cash", label: "Caixa", icon: DollarSign, priority: true },
  { id: "returns", label: "Trocas", icon: RotateCcw },
  { id: "requests", label: "Solicitações", icon: ArrowRightLeft, badge: true },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "whatsapp", label: "WhatsApp", icon: Phone },
  { id: "seller-dashboard", label: "Vendedores", icon: Trophy },
  { id: "checkout", label: "Checkout", icon: CreditCard },
  { id: "slowmoving", label: "Queima", icon: Flame },
  { id: "searches", label: "Procurados", icon: SearchX },
  { id: "config", label: "Config", icon: Settings },
];

export default function POS() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [section, setSection] = useState<POSSection>("dashboard");
  const [whatsappFilter, setWhatsappFilter] = useState<WhatsAppFilter>(undefined);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [pendingStockChecks, setPendingStockChecks] = useState(0);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Config PIN gate
  const [configAuthenticated, setConfigAuthenticated] = useState(false);
  const [showConfigPin, setShowConfigPin] = useState(false);
  const [configPin, setConfigPin] = useState("");

  // Pre-load sellers as soon as store is selected (before POSSalesView mounts)
  const [sellers, setSellers] = useState<{ id: string; name: string; tiny_seller_id?: string }[]>([]);
  const [sellersLoaded, setSellersLoaded] = useState(false);

  const loadSellers = useCallback(async () => {
    if (!selectedStore) { setSellers([]); setSellersLoaded(false); return; }
    try {
      const { data } = await supabase
        .from('pos_sellers')
        .select('id, name, tiny_seller_id')
        .eq('store_id', selectedStore)
        .eq('is_active', true)
        .order('name');
      setSellers(data || []);
    } catch (e) {
      console.error('Load sellers error:', e);
    } finally {
      setSellersLoaded(true);
    }
  }, [selectedStore]);

  useEffect(() => { loadSellers(); }, [loadSellers]);

  // Reload sellers when switching back to sales (e.g. after toggling active in config)
  useEffect(() => {
    if (section === 'sales' && selectedStore) loadSellers();
  }, [section]);

  // Handle config section click with PIN gate
  const handleSectionClick = (sectionId: POSSection) => {
    if (sectionId === "config" && !configAuthenticated) {
      setShowConfigPin(true);
      setConfigPin("");
      return;
    }
    setSection(sectionId);
  };

  const handleConfigPinComplete = (value: string) => {
    setConfigPin(value);
    if (value.length === 4) {
      if (value === CONFIG_PIN) {
        setConfigAuthenticated(true);
        setShowConfigPin(false);
        setSection("config");
        toast.success("Acesso liberado!");
      } else {
        toast.error("PIN incorreto!");
        setConfigPin("");
      }
    }
  };

  // Realtime count of pending requests for this store
  useEffect(() => {
    if (!selectedStore) return;
    const loadPending = async () => {
      const [{ count: interStoreCount }, { count: stockCheckCount }] = await Promise.all([
        supabase
          .from("pos_inter_store_requests")
          .select("id", { count: "exact", head: true })
          .eq("to_store_id", selectedStore)
          .eq("status", "pending"),
        supabase
          .from("expedition_stock_requests")
          .select("id", { count: "exact", head: true })
          .eq("to_store_id", selectedStore)
          .eq("status", "pending"),
      ]);
      setPendingRequests((interStoreCount || 0) + (stockCheckCount || 0));
      setPendingStockChecks(stockCheckCount || 0);
    };
    loadPending();

    const channel = supabase
      .channel("pos-requests-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_inter_store_requests" }, () => loadPending())
      .on("postgres_changes", { event: "*", schema: "public", table: "expedition_stock_requests" }, () => loadPending())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedStore]);

  if (!selectedStore) {
    return <POSStoreSelector onSelect={setSelectedStore} />;
  }

  // Mobile: show priority tabs in bottom bar, rest in "more" menu
  const primarySections = SECTIONS.filter(s => s.priority);
  const secondarySections = SECTIONS.filter(s => !s.priority);

  return (
    <div className="h-screen flex flex-col md:flex-row bg-pos-black">
      {/* Desktop Sidebar */}
      {!isMobile && (
        <div className="w-16 lg:w-52 border-r border-pos-white/10 bg-pos-white flex flex-col">
          {/* Logo */}
          <div className="p-3 border-b border-pos-white/10 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pos-yellow text-pos-black font-bold flex-shrink-0">
              <Store className="h-4 w-4" />
            </div>
            <div className="hidden lg:block min-w-0">
              <h1 className="text-xs font-bold text-white truncate">Frente de Caixa</h1>
              <p className="text-[10px] text-pos-yellow-muted truncate">PDV</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              const isActive = section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => handleSectionClick(s.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all relative",
                    isActive
                      ? "bg-pos-yellow text-pos-white shadow-md shadow-pos-yellow/30"
                      : "text-white/60 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden lg:inline">{s.label}</span>
                  {s.id === "config" && <Lock className="h-3 w-3 opacity-50 hidden lg:inline" />}
                  {s.badge && pendingRequests > 0 && (
                    <Badge className="absolute -top-1 -right-1 lg:static lg:ml-auto bg-red-500 text-white border-0 text-[10px] h-4 min-w-4 px-1">
                      {pendingRequests}
                    </Badge>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-2 border-t border-white/10 space-y-1">
            <button
              onClick={() => setSelectedStore("")}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-white/40 hover:bg-white/10 hover:text-white/70 transition-all"
            >
              <Store className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden lg:inline">Trocar Loja</span>
            </button>
            <button
              onClick={() => navigate("/")}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-white/40 hover:bg-white/10 hover:text-white/70 transition-all"
            >
              <Home className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden lg:inline">Início</span>
            </button>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {section === "dashboard" && (
          <POSDashboard
            storeId={selectedStore}
            onNavigateToSection={(s) => setSection(s as POSSection)}
          />
        )}
        {section === "sales" && (
          <POSSalesView
            storeId={selectedStore}
            preloadedSellers={sellers}
            sellersPreloaded={sellersLoaded}
            onNavigateToWhatsApp={(filter) => {
              setSection("whatsapp");
              setWhatsappFilter(filter);
            }}
            onCloseSalesView={() => setSection("dashboard")}
          />
        )}
        {section === "cash" && <POSCashRegister storeId={selectedStore} />}
        
        {section === "config" && configAuthenticated && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-pos-white/50"><Loader2 className="h-6 w-6 animate-spin mr-2" />Carregando configurações...</div>}>
            <POSConfig storeId={selectedStore} />
          </Suspense>
        )}
        {section === "returns" && <POSExchanges storeId={selectedStore} />}
        {section === "requests" && <POSInterStoreRequests storeId={selectedStore} />}
        
        {section === "whatsapp" && <POSWhatsApp storeId={selectedStore} initialFilter={whatsappFilter as any} />}
        {section === "online" && <POSOnlineSales storeId={selectedStore} sellers={sellers} />}
        {section === "daily" && <POSDailySales storeId={selectedStore} />}
        {section === "pickups" && <POSPickupOrders storeId={selectedStore} />}
        {section === "searches" && <POSProductSearchLog storeId={selectedStore} />}
        {section === "checkout" && <POSCheckoutMonitor storeId={selectedStore} />}
        {section === "chat" && <POSTeamChat storeId={selectedStore} />}
        {section === "slowmoving" && <POSSlowMovingProducts storeId={selectedStore} />}
        {section === "shipments" && <POSShipments storeId={selectedStore} />}
        {section === "seller-dashboard" && <POSSellerDashboard storeId={selectedStore} />}
      </div>

      {/* Config PIN Dialog */}
      <Dialog open={showConfigPin} onOpenChange={setShowConfigPin}>
        <DialogContent className="bg-pos-black border-pos-orange/30 text-pos-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-pos-white">
              <Lock className="h-4 w-4 text-pos-orange" /> Acesso às Configurações
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-6 py-8">
            <p className="text-sm text-pos-white/60">Digite o PIN para acessar as configurações</p>
            <InputOTP maxLength={4} value={configPin} onChange={handleConfigPinComplete}>
              <InputOTPGroup>
                <InputOTPSlot index={0} className="border-pos-orange/30 text-pos-white bg-pos-white/5" />
                <InputOTPSlot index={1} className="border-pos-orange/30 text-pos-white bg-pos-white/5" />
                <InputOTPSlot index={2} className="border-pos-orange/30 text-pos-white bg-pos-white/5" />
                <InputOTPSlot index={3} className="border-pos-orange/30 text-pos-white bg-pos-white/5" />
              </InputOTPGroup>
            </InputOTP>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <>
          {/* More menu overlay */}
          {showMoreMenu && (
            <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowMoreMenu(false)}>
              <div className="absolute bottom-16 left-0 right-0 bg-card border-t border-border rounded-t-2xl p-4 safe-area-pb" onClick={e => e.stopPropagation()}>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {secondarySections.map(s => {
                    const Icon = s.icon;
                    const isActive = section === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => { handleSectionClick(s.id); setShowMoreMenu(false); }}
                        className={cn(
                          "flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all relative",
                          isActive
                            ? "bg-pos-yellow text-pos-black"
                            : "text-foreground/60 hover:bg-muted"
                        )}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="truncate max-w-full">{s.label}</span>
                        {s.badge && pendingRequests > 0 && (
                          <Badge className="absolute -top-1 -right-1 bg-red-500 text-white border-0 text-[10px] h-4 min-w-4 px-1">
                            {pendingRequests}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1 text-xs text-muted-foreground" onClick={() => { setSelectedStore(""); setShowMoreMenu(false); }}>
                    <Store className="h-3.5 w-3.5 mr-1" /> Trocar Loja
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1 text-xs text-muted-foreground" onClick={() => navigate("/")}>
                    <Home className="h-3.5 w-3.5 mr-1" /> Início
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Bottom tab bar */}
          <div className="flex-shrink-0 border-t border-border bg-card safe-area-pb z-30">
            <div className="flex items-stretch">
              {primarySections.map(s => {
                const Icon = s.icon;
                const isActive = section === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => { handleSectionClick(s.id); setShowMoreMenu(false); }}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-all relative",
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground"
                    )}
                  >
                    <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
                    <span>{s.label}</span>
                    {isActive && <div className="absolute top-0 left-1/4 right-1/4 h-0.5 rounded-full bg-primary" />}
                  </button>
                );
              })}
              {/* More button */}
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-all relative",
                  (showMoreMenu || secondarySections.some(s => s.id === section))
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                {showMoreMenu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                <span>Mais</span>
                {pendingRequests > 0 && (
                  <Badge className="absolute top-0.5 right-1/4 bg-red-500 text-white border-0 text-[10px] h-4 min-w-4 px-1">
                    {pendingRequests}
                  </Badge>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
