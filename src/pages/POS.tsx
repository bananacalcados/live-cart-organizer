import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store, Home, ShoppingCart, DollarSign, RotateCcw, MessageSquare,
  ArrowRightLeft, Settings, Trophy, Phone, Bell
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { POSStoreSelector } from "@/components/pos/POSStoreSelector";
import { POSSalesView } from "@/components/pos/POSSalesView";
import { POSCashRegister } from "@/components/pos/POSCashRegister";
import { POSGamificationMini } from "@/components/pos/POSGamificationMini";
import { POSConfig } from "@/components/pos/POSConfig";
import { TeamChat } from "@/components/TeamChat";

type POSSection = "sales" | "cash" | "returns" | "chat" | "requests" | "config" | "gamification" | "whatsapp";

const SECTIONS: { id: POSSection; label: string; icon: typeof ShoppingCart; badge?: boolean }[] = [
  { id: "sales", label: "Venda", icon: ShoppingCart },
  { id: "cash", label: "Caixa", icon: DollarSign },
  { id: "returns", label: "Trocas", icon: RotateCcw },
  { id: "requests", label: "Solicitações", icon: ArrowRightLeft, badge: true },
  { id: "chat", label: "Chat Equipe", icon: MessageSquare },
  { id: "whatsapp", label: "WhatsApp", icon: Phone },
  { id: "gamification", label: "Ranking", icon: Trophy },
  { id: "config", label: "Config", icon: Settings },
];

export default function POS() {
  const navigate = useNavigate();
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [section, setSection] = useState<POSSection>("sales");
  const [pendingRequests] = useState(0); // TODO: realtime

  if (!selectedStore) {
    return <POSStoreSelector onSelect={setSelectedStore} />;
  }

  return (
    <div className="h-screen flex bg-pos-black">
      {/* Sidebar */}
      <div className="w-16 lg:w-52 border-r border-pos-yellow/20 bg-pos-black flex flex-col">
        {/* Logo */}
        <div className="p-3 border-b border-pos-yellow/20 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pos-yellow text-pos-black font-bold flex-shrink-0">
            <Store className="h-4 w-4" />
          </div>
          <div className="hidden lg:block min-w-0">
            <h1 className="text-xs font-bold text-pos-white truncate">Frente de Caixa</h1>
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
                    ? "bg-pos-yellow text-pos-black shadow-md shadow-pos-yellow/30"
                    : "text-pos-white/60 hover:bg-pos-white/5 hover:text-pos-white"
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
        <div className="p-2 border-t border-pos-yellow/20 space-y-1">
          <button
            onClick={() => setSelectedStore("")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-pos-white/40 hover:bg-pos-white/5 hover:text-pos-white/70 transition-all"
          >
            <Store className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="hidden lg:inline">Trocar Loja</span>
          </button>
          <button
            onClick={() => navigate("/")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-pos-white/40 hover:bg-pos-white/5 hover:text-pos-white/70 transition-all"
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
        {section === "returns" && (
          <div className="flex-1 flex items-center justify-center text-pos-white/40">
            <div className="text-center space-y-2">
              <RotateCcw className="h-12 w-12 mx-auto opacity-30" />
              <p className="text-lg font-medium">Trocas & Devoluções</p>
              <p className="text-sm">Será implementado na Fase 2</p>
            </div>
          </div>
        )}
        {section === "requests" && (
          <div className="flex-1 flex items-center justify-center text-pos-white/40">
            <div className="text-center space-y-2">
              <ArrowRightLeft className="h-12 w-12 mx-auto opacity-30" />
              <p className="text-lg font-medium">Solicitações entre Lojas</p>
              <p className="text-sm">Será implementado na Fase 2</p>
            </div>
          </div>
        )}
        {section === "chat" && (
          <div className="flex-1 p-6 overflow-hidden">
            <div className="h-full rounded-xl border border-pos-yellow/20 overflow-hidden">
              <TeamChat />
            </div>
          </div>
        )}
        {section === "whatsapp" && (
          <div className="flex-1 flex items-center justify-center text-pos-white/40">
            <div className="text-center space-y-2">
              <Phone className="h-12 w-12 mx-auto opacity-30" />
              <p className="text-lg font-medium">Chat WhatsApp</p>
              <p className="text-sm">Será integrado na próxima iteração</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
