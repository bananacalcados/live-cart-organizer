import { memo, useMemo, useState } from "react";
import { QrCode, CreditCard, Check, X, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePixNotificationStore, type PixTab } from "@/stores/pixNotificationStore";

/**
 * Barra de "abas" (estilo aba de navegador do Chrome) que lista os PIX/checkout
 * aguardando pagamento. Fica fixa no topo da área de chat, persiste ao trocar de
 * conversa. Aba paga AO VIVO fica piscando em verde até o operador clicar/descartar.
 */
// Formatadores criados UMA vez (toLocale*String cria um Intl.DateTimeFormat a
// cada chamada — com centenas de abas isso era o maior custo de cada clique).
const TIME_FMT = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DATE_FMT = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const dateLabelCache = new Map<string, { day: string; label: string }>();

function formatTabDate(iso: string): string {
  try {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const cached = dateLabelCache.get(iso);
    if (cached && cached.day === todayKey) return cached.label;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    const time = TIME_FMT.format(d);
    const label = sameDay ? `Hoje ${time}` : `${DATE_FMT.format(d)} ${time}`;
    if (dateLabelCache.size > 2000) dateLabelCache.clear();
    dateLabelCache.set(iso, { day: todayKey, label });
    return label;
  } catch {
    return "";
  }
}

export const PixPendingTabsBar = memo(function PixPendingTabsBar() {
  const tabs = usePixNotificationStore((s) => s.tabs);

  const paidTabs = useMemo(() => tabs.filter((t) => t.status === "paid"), [tabs]);
  const pendingTabs = useMemo(() => tabs.filter((t) => t.status !== "paid"), [tabs]);

  if (tabs.length === 0) return null;

  return (
    <div className="flex flex-col bg-black/20 border-b border-white/10">
      <TabsRow label="Pagos" count={paidTabs.length} tabs={paidTabs} tone="text-emerald-300" />
      <TabsRow label="Aguardando" count={pendingTabs.length} tabs={pendingTabs} tone="text-amber-300" />
    </div>
  );
});

const TabsRow = memo(function TabsRow({ label, count, tabs, tone }: { label: string; count: number; tabs: PixTab[]; tone: string }) {
  const requestOpen = usePixNotificationStore((s) => s.requestOpen);
  const dismiss = usePixNotificationStore((s) => s.dismiss);
  const dismissMany = usePixNotificationStore((s) => s.dismissMany);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (saleId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(saleId)) next.delete(saleId);
      else next.add(saleId);
      return next;
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const allSelected = tabs.length > 0 && tabs.every((t) => selected.has(t.saleId));

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <div className="flex items-end gap-1.5 px-2 pt-1.5 overflow-x-auto scrollbar-thin">
        <span className={cn("shrink-0 self-center mr-1 text-[10px] font-bold uppercase tracking-wide", tone)}>
          {label} <span className="opacity-80">({count})</span>
        </span>

        {tabs.length > 0 && (
          <button
            type="button"
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            title={selectMode ? "Cancelar seleção" : "Selecionar vários para fechar"}
            className={cn(
              "shrink-0 self-center mr-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase transition-colors",
              selectMode
                ? "bg-white/15 text-white"
                : "text-zinc-400 hover:bg-white/10 hover:text-zinc-100",
            )}
          >
            <CheckSquare className="h-3 w-3" />
            {selectMode ? "Cancelar" : "Selecionar"}
          </button>
        )}

        {tabs.length === 0 && (
          <span className="self-center pb-1 text-[11px] text-zinc-400">Nenhum</span>
        )}
        {tabs.map((tab) => {
          const paid = tab.status === "paid";
          const Icon = tab.type === "checkout" ? CreditCard : QrCode;
          const dateLabel = formatTabDate(tab.createdAt);
          const isChecked = selected.has(tab.saleId);
          return (
            <button
              key={tab.saleId}
              onClick={() => (selectMode ? toggle(tab.saleId) : requestOpen(tab.phone, tab.numberId))}
              title={
                selectMode
                  ? "Selecionar para fechar"
                  : paid
                    ? "Pagamento confirmado — abrir conversa"
                    : "Aguardando pagamento — abrir conversa"
              }
              className={cn(
                "group relative flex items-center gap-2 max-w-[250px] min-w-[160px] px-3 py-1.5 rounded-t-lg border border-b-0 text-left transition-colors shrink-0",
                paid
                  ? tab.fresh
                    ? "bg-emerald-500 border-emerald-400 text-white animate-pix-blink shadow-lg"
                    : "bg-emerald-600/90 border-emerald-500 text-white"
                  : "bg-zinc-800 border-zinc-600 text-zinc-100 hover:bg-zinc-700",
                selectMode && isChecked && "ring-2 ring-sky-400",
                selectMode && !isChecked && "opacity-70",
              )}
            >
              {selectMode && (
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    isChecked ? "bg-sky-500 border-sky-400 text-white" : "border-white/40",
                  )}
                >
                  {isChecked && <Check className="h-3 w-3" />}
                </span>
              )}
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
              {!paid && !selectMode && (
                <span className="ml-1 h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
              )}
              {!selectMode && (
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
              )}
            </button>
          );
        })}
      </div>

      {selectMode && (
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setSelected(allSelected ? new Set() : new Set(tabs.map((t) => t.saleId)))}
            className="rounded border border-white/20 px-2 py-0.5 text-[11px] font-medium text-zinc-200 hover:bg-white/10"
          >
            {allSelected ? "Limpar seleção" : `Selecionar todos (${tabs.length})`}
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => {
              dismissMany(Array.from(selected));
              exitSelect();
            }}
            className="flex items-center gap-1 rounded bg-destructive px-2 py-0.5 text-[11px] font-semibold text-destructive-foreground disabled:opacity-40"
          >
            <X className="h-3 w-3" />
            Fechar selecionados ({selected.size})
          </button>
        </div>
      )}
    </div>
  );
}
