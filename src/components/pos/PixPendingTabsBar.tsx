import { QrCode, CreditCard, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePixNotificationStore } from "@/stores/pixNotificationStore";

/**
 * Barra de "abas" (estilo aba de navegador do Chrome) que lista os PIX/checkout
 * aguardando pagamento. Fica fixa no topo da área de chat, persiste ao trocar de
 * conversa. Aba paga fica piscando em verde até o operador clicar/descartar.
 */
export function PixPendingTabsBar() {
  const tabs = usePixNotificationStore((s) => s.tabs);
  const requestOpen = usePixNotificationStore((s) => s.requestOpen);
  const dismiss = usePixNotificationStore((s) => s.dismiss);

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-end gap-1.5 px-2 pt-1.5 overflow-x-auto bg-black/20 border-b border-white/10 scrollbar-thin">
      {tabs.map((tab) => {
        const paid = tab.status === "paid";
        const Icon = tab.type === "checkout" ? CreditCard : QrCode;
        return (
          <button
            key={tab.saleId}
            onClick={() => {
              requestOpen(tab.phone, tab.numberId);
              if (paid) dismiss(tab.saleId);
            }}
            title={paid ? "Pagamento confirmado — abrir conversa" : "Aguardando pagamento — abrir conversa"}
            className={cn(
              "group relative flex items-center gap-2 max-w-[230px] min-w-[150px] px-3 py-1.5 rounded-t-lg border border-b-0 text-left transition-colors shrink-0",
              paid
                ? "bg-emerald-500 border-emerald-400 text-white animate-pix-blink shadow-lg"
                : "bg-zinc-800 border-zinc-600 text-zinc-100 hover:bg-zinc-700",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full shrink-0",
                paid ? "bg-white/25" : "bg-amber-400/20",
              )}
            >
              {paid ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5 text-amber-300" />}
            </span>
            <span className="flex flex-col min-w-0 leading-tight">
              <span className="truncate text-xs font-semibold">{tab.name}</span>
              <span className={cn("text-[11px]", paid ? "text-white/90" : "text-zinc-400")}>
                {paid ? "PAGO • " : "Aguardando • "}R$ {tab.amount.toFixed(2)}
              </span>
            </span>
            {!paid && (
              <span className="ml-auto h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            )}
            {paid && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(tab.saleId);
                }}
                className="ml-auto rounded p-0.5 hover:bg-white/25 shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
