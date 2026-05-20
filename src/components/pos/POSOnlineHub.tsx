import { useState } from "react";
import { Link2, Calendar, ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { POSOnlineSales } from "./POSOnlineSales";
import Events from "@/pages/Events";

interface Seller {
  id: string;
  name: string;
  tiny_seller_id?: string;
}

interface Props {
  storeId: string;
  sellers: Seller[];
}

type Mode = "menu" | "checkout" | "events";

export function POSOnlineHub({ storeId, sellers }: Props) {
  const [mode, setMode] = useState<Mode>("menu");

  if (mode === "checkout") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-orange-100/60 bg-white/60 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("menu")}
            className="gap-2 text-neutral-700 hover:bg-orange-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          <POSOnlineSales storeId={storeId} sellers={sellers} />
        </div>
      </div>
    );
  }

  if (mode === "events") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-orange-100/60 bg-white/60 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("menu")}
            className="gap-2 text-neutral-700 hover:bg-orange-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para Online
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          <Events />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 md:p-10" style={{ background: "var(--pos-bg, #f5f0e8)" }}>
      <div className="max-w-3xl mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-neutral-800 mb-1">Vendas Online</h2>
        <p className="text-sm text-neutral-500 mb-6">Escolha como deseja registrar uma venda online</p>

        <div className="grid md:grid-cols-2 gap-4">
          <button
            onClick={() => setMode("checkout")}
            className="text-left bg-white border border-orange-200/60 rounded-2xl p-6 shadow-[var(--shadow-pos-card,0_4px_12px_rgba(0,0,0,0.06))] hover:shadow-xl hover:-translate-y-0.5 transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-md">
                <Link2 className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-neutral-800">Criar Link de Pagamento</h3>
                  <ChevronRight className="h-5 w-5 text-neutral-400 group-hover:text-orange-500 group-hover:translate-x-0.5 transition" />
                </div>
                <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                  Localize produtos, escolha o vendedor e envie um link de checkout ao cliente
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setMode("events")}
            className="text-left bg-white border border-purple-200/60 rounded-2xl p-6 shadow-[var(--shadow-pos-card,0_4px_12px_rgba(0,0,0,0.06))] hover:shadow-xl hover:-translate-y-0.5 transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-md">
                <Calendar className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-neutral-800">Eventos</h3>
                  <ChevronRight className="h-5 w-5 text-neutral-400 group-hover:text-violet-500 group-hover:translate-x-0.5 transition" />
                </div>
                <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                  Acesse e crie eventos / lives, lance pedidos e gerencie clientes diretamente do PDV
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
