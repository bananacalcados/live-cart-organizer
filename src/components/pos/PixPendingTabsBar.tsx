import { QrCode, CreditCard, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePixNotificationStore } from "@/stores/pixNotificationStore";

/**
 * Barra de "abas" (estilo aba de navegador do Chrome) que lista os PIX/checkout
 * aguardando pagamento. Fica fixa no topo da área de chat, persiste ao trocar de
 * conversa. Aba paga AO VIVO fica piscando em verde até o operador clicar/descartar.
 */
function formatTabDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (sameDay) return `Hoje ${time}`;
    const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return `${date} ${time}`;
  } catch {
    return "";
  }
}

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
        const dateLabel = formatTabDate(tab.createdAt);
        return (
          <button
            key={tab.saleId}
            onClick={() => requestOpen(tab.phone, tab.numberId)}
            title={paid ? "Pagamento confirmado — abrir conversa" : "Aguardando pagamento — abrir conversa"}
            className={cn(
              "group relative flex items-center gap-2 max-w-[250px] min-w-[160px] px-3 py-1.5 rounded-t-lg border border-b-0 text-left transition-colors shrink-0",
              paid
                ? tab.fresh
                  ? "bg-emerald-500 border-emerald-400 text-white animate-pix-blink shadow-lg"
                  : "bg-emerald-600/90 border-emerald-500 text-white"
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
              <span className="flex items-center gap-1 min-w-0">
                <span className="truncate text-xs font-semibold">{tab.name}</span>
                {tab.isLive && (
                  <span className="shrink-0 rounded-sm bg-fuchsia-500/90 px-1 text-[9px] font-bold uppercase leading-tight text-white">
                    Live
                  </span>
                )}
              </span>
              <span className={cn("text-[11px]", paid ? "text-white/90" : "text-zinc-400")}>
                {paid ? "PAGO • " : "Aguardando • "}R$ {tab.amount.toFixed(2)}
              </span>
              {(tab.storeName || tab.instanceLabel) && (
                <span className={cn("truncate text-[10px]", paid ? "text-white/80" : "text-zinc-400")}>
                  {[tab.storeName, tab.instanceLabel].filter(Boolean).join(" · ")}
                </span>
              )}
              {tab.orderNumber && (
                <span className={cn("truncate text-[10px]", paid ? "text-white/70" : "text-zinc-500")}>
                  Pedido #{tab.orderNumber}
                </span>
              )}
              {dateLabel && (
                <span className={cn("text-[10px]", paid ? "text-white/70" : "text-zinc-500")}>
                  {dateLabel}
                </span>
              )}
            </span>
            {!paid && (
              <span className="ml-1 h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            )}
            <span
              role="button"
              tabIndex={0}
              title="Fechar (não mostrar mais)"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(tab.saleId);
              }}
              className={cn(
                "ml-1 rounded p-0.5 shrink-0",
                paid ? "hover:bg-white/25" : "hover:bg-white/10",
              )}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
