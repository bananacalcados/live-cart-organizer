import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store, Home, ShoppingCart, DollarSign, RotateCcw, MessageSquare,
  ArrowRightLeft, Settings, Trophy, Phone, Bell, BarChart3, SearchX,
  Menu, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { POSStoreSelector } from "@/components/pos/POSStoreSelector";
import { POSSalesView } from "@/components/pos/POSSalesView";
import { POSCashRegister } from "@/components/pos/POSCashRegister";
import { POSGamificationMini } from "@/components/pos/POSGamificationMini";
import { POSConfig } from "@/components/pos/POSConfig";
import { POSExchanges } from "@/components/pos/POSExchanges";
import { POSInterStoreRequests } from "@/components/pos/POSInterStoreRequests";
import { POSWhatsApp } from "@/components/pos/POSWhatsApp";
import { POSProductSearchLog } from "@/components/pos/POSProductSearchLog";
import { POSDailySales } from "@/components/pos/POSDailySales";
import { POSTeamChat } from "@/components/pos/POSTeamChat";
import { supabase } from "@/integrations/supabase/client";

type POSSection = "sales" | "cash" | "returns" | "chat" | "requests" | "config" | "gamification" | "whatsapp" | "daily" | "searches";
type WhatsAppFilter = "unanswered" | undefined;

const SECTIONS: { id: POSSection; label: string; icon: typeof ShoppingCart; badge?: boolean; priority?: boolean }[] = [
  { id: "sales", label: "Venda", icon: ShoppingCart, priority: true },
  { id: "daily", label: "Vendas Dia", icon: BarChart3, priority: true },
  { id: "cash", label: "Caixa", icon: DollarSign, priority: true },
  { id: "returns", label: "Trocas", icon: RotateCcw, priority: true },
  { id: "requests", label: "Solicitações", icon: ArrowRightLeft, badge: true },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "whatsapp", label: "WhatsApp", icon: Phone },
  { id: "searches", label: "Procurados", icon: SearchX },
  { id: "gamification", label: "Ranking", icon: Trophy },
  { id: "config", label: "Config", icon: Settings },
];

export default function POS() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [section, setSection] = useState<POSSection>("sales");
  const [whatsappFilter, setWhatsappFilter] = useState<WhatsAppFilter>(undefined);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Pre-load sellers as soon as store is selected (before POSSalesView mounts)
  const [sellers, setSellers] = useState<{ id: string; name: string; tiny_seller_id?: string }[]>([]);
  const [sellersLoaded, setSellersLoaded] = useState(false);

  const loadSellers = useCallback(() => {
    if (!selectedStore) { setSellers([]); setSellersLoaded(false); return; }
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-sellers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ store_id: selectedStore }),
    })
      .then(r => r.json())
      .then(data => { if (data.success) setSellers(data.sellers || []); })
      .catch(e => console.error('Pre-load sellers error:', e))
      .finally(() => setSellersLoaded(true));
  }, [selectedStore]);

  useEffect(() => { loadSellers(); }, [loadSellers]);

  // Reload sellers when switching back to sales (e.g. after toggling active in config)
  useEffect(() => {
    if (section === 'sales' && selectedStore) loadSellers();
  }, [section]);

  // Realtime count of pending requests for this store
  useEffect(() => {
    if (!selectedStore) return;
    const loadPending = async () => {
      const { count } = await supabase
        .from("pos_inter_store_requests")
        .select("id", { count: "exact", head: true })
        .eq("to_store_id", selectedStore)
        .eq("status", "pending");
      setPendingRequests(count || 0);
    };
    loadPending();

    const channel = supabase
      .channel("pos-requests-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_inter_store_requests" }, () => loadPending())
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
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all relative",
                    isActive
                      ? "bg-pos-yellow text-pos-white shadow-md shadow-pos-yellow/30"
                      : "text-white/60 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden lg:inline">{s.label}</span>
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
        {section === "sales" && (
          <POSSalesView
            storeId={selectedStore}
            preloadedSellers={sellers}
            sellersPreloaded={sellersLoaded}
            onNavigateToWhatsApp={(filter) => {
              setSection("whatsapp");
              setWhatsappFilter(filter);
            }}
          />
        )}
        {section === "cash" && <POSCashRegister storeId={selectedStore} />}
        {section === "gamification" && <POSGamificationMini storeId={selectedStore} />}
        {section === "config" && <POSConfig storeId={selectedStore} />}
        {section === "returns" && <POSExchanges storeId={selectedStore} />}
        {section === "requests" && <POSInterStoreRequests storeId={selectedStore} />}
        {section === "whatsapp" && <POSWhatsApp storeId={selectedStore} initialFilter={whatsappFilter} />}
        {section === "daily" && <POSDailySales storeId={selectedStore} />}
        {section === "searches" && <POSProductSearchLog storeId={selectedStore} />}
        {section === "chat" && <POSTeamChat storeId={selectedStore} />}
      </div>

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
                        onClick={() => { setSection(s.id); setShowMoreMenu(false); }}
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
                    onClick={() => { setSection(s.id); setShowMoreMenu(false); }}
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
