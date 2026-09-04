import { ReactNode, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveLaneSectionProps {
  id: string;
  eventId?: string | null;
  title: string;
  count: number;
  /** Classe de cor do título/contador (token semântico). */
  tone: string;
  icon?: ReactNode;
  children: ReactNode;
}

/** Linha (etapa de atendimento) da aba Pedidos: título com contador + conteúdo recolhível. */
export function LiveLaneSection({ id, eventId, title, count, tone, icon, children }: LiveLaneSectionProps) {
  const storageKey = `live-lane-collapsed:${eventId || "none"}:${id}`;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(storageKey) === "1");
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <section className="rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-1 py-0.5 text-left"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 opacity-60" /> : <ChevronDown className="h-3.5 w-3.5 opacity-60" />}
        {icon}
        <span className={cn("text-[11px] font-bold uppercase tracking-wide", tone)}>{title}</span>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", tone, "bg-current/10")}>
          <span className="text-current">{count}</span>
        </span>
      </button>
      {!collapsed && <div className="pt-1">{children}</div>}
    </section>
  );
}
