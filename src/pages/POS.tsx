import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store, Home, ShoppingCart, DollarSign, RotateCcw, MessageSquare,
  ArrowRightLeft, Settings, Trophy, Phone, Bell, BarChart3, SearchX
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

const SECTIONS: { id: POSSection; label: string; icon: typeof ShoppingCart; badge?: boolean }[] = [
  { id: "sales", label: "Venda", icon: ShoppingCart },
  { id: "daily", label: "Vendas Dia", icon: BarChart3 },
  { id: "cash", label: "Caixa", icon: DollarSign },
  { id: "returns", label: "Trocas", icon: RotateCcw },
  { id: "requests", label: "Solicitações", icon: ArrowRightLeft, badge: true },
  { id: "chat", label: "Chat Equipe", icon: MessageSquare },
  { id: "whatsapp", label: "WhatsApp", icon: Phone },
  { id: "searches", label: "Procurados", icon: SearchX },
  { id: "gamification", label: "Ranking", icon: Trophy },
  { id: "config", label: "Config", icon: Settings },
];

export default function POS() {
  const navigate = useNavigate();
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [section, setSection] = useState<POSSection>("sales");
  const [pendingRequests, setPendingRequests] = useState(0);

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

  return (
    <div className="h-screen flex bg-pos-black">
      {/* Sidebar */}
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

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {section === "sales" && <POSSalesView storeId={selectedStore} />}
        {section === "cash" && <POSCashRegister storeId={selectedStore} />}
        {section === "gamification" && <POSGamificationMini storeId={selectedStore} />}
        {section === "config" && <POSConfig storeId={selectedStore} />}
        {section === "returns" && <POSExchanges storeId={selectedStore} />}
        {section === "requests" && <POSInterStoreRequests storeId={selectedStore} />}
        {section === "whatsapp" && <POSWhatsApp storeId={selectedStore} />}
        {section === "daily" && <POSDailySales storeId={selectedStore} />}
        {section === "searches" && <POSProductSearchLog storeId={selectedStore} />}
        {section === "chat" && <POSTeamChat storeId={selectedStore} />}
      </div>
    </div>
  );
}
