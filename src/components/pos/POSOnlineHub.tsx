import { useState } from "react";
import { Link2, Calendar, ArrowLeft, ChevronRight, Package, Receipt, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { POSOnlineSales } from "./POSOnlineSales";
import { POSCustomLinkDialog } from "./POSCustomLinkDialog";
import { CarouselTemplatesLadder } from "@/components/admin/CarouselTemplatesLadder";
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

type Mode = "menu" | "link-choice" | "checkout" | "custom-link" | "events" | "automacao";

export function POSOnlineHub({ storeId, sellers }: Props) {
  const [mode, setMode] = useState<Mode>("menu");

  if (mode === "link-choice") {
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
        <div className="flex-1 overflow-auto p-6 md:p-10" style={{ background: "var(--pos-bg, #f5f0e8)" }}>
          <div className="max-w-3xl mx-auto">
            <h2 className="text-xl md:text-2xl font-bold text-neutral-800 mb-1">Criar Link de Pagamento</h2>
            <p className="text-sm text-neutral-500 mb-6">Escolha o tipo de link que deseja gerar</p>

            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => setMode("checkout")}
                className="text-left bg-white border border-orange-200/60 rounded-2xl p-6 shadow-[var(--shadow-pos-card,0_4px_12px_rgba(0,0,0,0.06))] hover:shadow-xl hover:-translate-y-0.5 transition-all group"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-md">
                    <Package className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-neutral-800">Criar link de produtos</h3>
                      <ChevronRight className="h-5 w-5 text-neutral-400 group-hover:text-orange-500 group-hover:translate-x-0.5 transition" />
                    </div>
                    <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                      Localize produtos, escolha o vendedor e envie um link de checkout ao cliente
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setMode("custom-link")}
                className="text-left bg-white border border-teal-200/60 rounded-2xl p-6 shadow-[var(--shadow-pos-card,0_4px_12px_rgba(0,0,0,0.06))] hover:shadow-xl hover:-translate-y-0.5 transition-all group"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow-md">
                    <Receipt className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-neutral-800">Criar link avulso</h3>
                      <ChevronRight className="h-5 w-5 text-neutral-400 group-hover:text-teal-500 group-hover:translate-x-0.5 transition" />
                    </div>
                    <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                      Cobre apenas um valor (ex.: diferença), sem produto vinculado e sem frete
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "checkout") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-orange-100/60 bg-white/60 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("link-choice")}
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

  if (mode === "custom-link") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-orange-100/60 bg-white/60 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("link-choice")}
            className="gap-2 text-neutral-700 hover:bg-orange-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
        </div>
        <div className="flex-1 overflow-auto" style={{ background: "var(--pos-bg, #f5f0e8)" }}>
          <POSCustomLinkDialog storeId={storeId} sellers={sellers} />
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

  if (mode === "automacao") {
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
        <div className="flex-1 overflow-auto p-4 md:p-6" style={{ background: "var(--pos-bg, #f5f0e8)" }}>
          <div className="max-w-5xl mx-auto">
            <CarouselTemplatesLadder />
          </div>
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
            onClick={() => setMode("link-choice")}
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
                  Link de produtos ou link avulso pelo checkout transparente
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

          <button
            onClick={() => setMode("automacao")}
            className="text-left bg-white border border-blue-200/60 rounded-2xl p-6 shadow-[var(--shadow-pos-card,0_4px_12px_rgba(0,0,0,0.06))] hover:shadow-xl hover:-translate-y-0.5 transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-md">
                <Zap className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-neutral-800">Automação</h3>
                  <ChevronRight className="h-5 w-5 text-neutral-400 group-hover:text-blue-500 group-hover:translate-x-0.5 transition" />
                </div>
                <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                  Campanhas automáticas de carrossel no WhatsApp: templates, públicos e disparos
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
